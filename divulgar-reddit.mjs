#!/usr/bin/env node
// Publica no r/pulsocientifico as matérias que já estão no ar e ainda não foram divulgadas.
//
//   node agente/divulgar-reddit.mjs            → publica (no máximo 1 por execução)
//   node agente/divulgar-reddit.mjs --simular  → mostra o que faria, sem publicar
//
// Regras de convivência embutidas:
//   - no máximo 1 post por execução e 1 a cada 90 minutos;
//   - nunca a mesma matéria duas vezes (registro em agente/divulgadas.json);
//   - só matéria publicada e já no ar (agendada para o futuro não conta);
//   - nada com mais de 2 dias (se ficou para trás, deixa passar);
//   - o resumo da matéria e o link do estudo vão num comentário logo abaixo do post.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRO = join(RAIZ, "agente", "divulgadas.json");
const SIMULAR = process.argv.includes("--simular");

const env = readFileSync(join(RAIZ, ".env"), "utf8");
const ler = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
const SUB = ler("REDDIT_SUB") || "pulsocientifico";
const ID = ler("REDDIT_ID"), SECRET = ler("REDDIT_SECRET"), REFRESH = ler("REDDIT_REFRESH");
const BASE = (ler("PULSO_SUPABASE_URL") || "").replace(/\/$/, "");
const CHAVE = ler("PULSO_CHAVE_PUBLICA");
const SITE = ler("PULSO_SITE") || "https://pulsocientifico.com.br";
const UA = "web:pulsocientifico:v1.0 (by /u/pulsocientifico)";

for (const [nome, v] of [["REDDIT_ID", ID], ["REDDIT_SECRET", SECRET], ["REDDIT_REFRESH", REFRESH], ["PULSO_SUPABASE_URL", BASE], ["PULSO_CHAVE_PUBLICA", CHAVE]]) {
  if (!v) { console.error(`Falta ${nome} no .env.`); process.exit(1); }
}

const ESPERA_MIN = 90;               // minutos entre um post e outro
const IDADE_MAX_H = 48;              // não divulga matéria velha
const registro = existsSync(REGISTRO) ? JSON.parse(readFileSync(REGISTRO, "utf8")) : { ultimo_em: null, feitas: [] };

const agora = Date.now();
if (registro.ultimo_em && agora - new Date(registro.ultimo_em).getTime() < ESPERA_MIN * 60000) {
  const faltam = Math.ceil((ESPERA_MIN * 60000 - (agora - new Date(registro.ultimo_em).getTime())) / 60000);
  console.log(`nada a fazer: último post foi há pouco, faltam ${faltam} min.`);
  process.exit(0);
}

// 1. matérias no ar, mais recentes primeiro
const colunas = "id,slug,titulo,linha_fina,editoria,publicada_em,fonte";
const r = await fetch(`${BASE}/rest/v1/materias?select=${colunas}&status=eq.publicada&publicada_em=lte.${new Date().toISOString()}&order=publicada_em.desc&limit=10`,
  { headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` } });
if (!r.ok) { console.error("não consegui ler as matérias:", r.status); process.exit(1); }
const materias = await r.json();

const candidata = materias.find((m) =>
  !registro.feitas.some((f) => f.id === m.id) &&
  (agora - new Date(m.publicada_em).getTime()) / 3600000 <= IDADE_MAX_H);

if (!candidata) { console.log("nada novo para divulgar."); process.exit(0); }

const url = `${SITE}/${candidata.editoria}/${candidata.slug}`;
const AREA = { saude: "Saúde", "inteligencia-artificial": "Inteligência Artificial", tecnologia: "Tecnologia",
               espaco: "Espaço", "clima-e-meio-ambiente": "Clima e Meio Ambiente", natureza: "Natureza" };
const flair = AREA[candidata.editoria] ?? null;
const fonte = candidata.fonte || {};
const linkEstudo = fonte.url || (fonte.doi ? `https://doi.org/${fonte.doi}` : "");
const comentario = [candidata.linha_fina,
  linkEstudo ? `\n\nEstudo original: ${linkEstudo}${fonte.revista ? ` (${fonte.revista})` : ""}` : "",
  "\n\nO texto completo explica o que foi medido e o que o estudo ainda não permite concluir."].join("");

console.log(`matéria: ${candidata.titulo}\nlink: ${url}\netiqueta: ${flair ?? "(nenhuma)"}`);
if (SIMULAR) { console.log("\n--simular: não publiquei nada.\ncomentário que iria junto:\n" + comentario); process.exit(0); }

// 2. token de acesso
const tokenResp = await fetch("https://www.reddit.com/api/v1/access_token", {
  method: "POST",
  headers: { Authorization: "Basic " + Buffer.from(`${ID}:${SECRET}`).toString("base64"),
             "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: REFRESH }),
});
const token = (await tokenResp.json()).access_token;
if (!token) { console.error("não consegui o token do Reddit. Rode: node agente/reddit-autorizar.mjs"); process.exit(1); }
const cab = { Authorization: `Bearer ${token}`, "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" };

// 3. etiqueta (flair), se a comunidade tiver uma com esse nome
let flair_id = null;
if (flair) {
  const fr = await fetch(`https://oauth.reddit.com/r/${SUB}/api/link_flair_v2`, { headers: { Authorization: `Bearer ${token}`, "User-Agent": UA } });
  if (fr.ok) flair_id = (await fr.json()).find((f) => (f.text || "").toLowerCase() === flair.toLowerCase())?.id ?? null;
}

// 4. publica o link
const corpo = new URLSearchParams({ api_type: "json", sr: SUB, kind: "link", title: candidata.titulo, url, resubmit: "false", sendreplies: "true" });
if (flair_id) { corpo.set("flair_id", flair_id); corpo.set("flair_text", flair); }
const env1 = await fetch("https://oauth.reddit.com/api/submit", { method: "POST", headers: cab, body: corpo });
const d1 = await env1.json();
const erros = d1?.json?.errors ?? [];
if (erros.length) { console.error("o Reddit recusou:", JSON.stringify(erros)); process.exit(1); }
const nome = d1?.json?.data?.name;          // t3_xxxxx
const linkPost = d1?.json?.data?.url;
console.log("publicado:", linkPost ?? nome);

// 5. comentário com o resumo e a fonte
if (nome) {
  const c = await fetch("https://oauth.reddit.com/api/comment", { method: "POST", headers: cab,
    body: new URLSearchParams({ api_type: "json", thing_id: nome, text: comentario }) });
  const dc = await c.json();
  console.log((dc?.json?.errors ?? []).length ? "comentário falhou" : "comentário publicado");
}

registro.ultimo_em = new Date().toISOString();
registro.feitas.unshift({ id: candidata.id, titulo: candidata.titulo, em: registro.ultimo_em, post: linkPost ?? nome });
registro.feitas = registro.feitas.slice(0, 200);
writeFileSync(REGISTRO, JSON.stringify(registro, null, 2), "utf8");

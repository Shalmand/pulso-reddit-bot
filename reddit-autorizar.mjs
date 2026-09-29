#!/usr/bin/env node
// Autoriza a conta do Reddit UMA VEZ e grava a chave de acesso no .env.
//
//   node agente/reddit-autorizar.mjs
//
// Antes: crie o aplicativo em https://www.reddit.com/prefs/apps
//   - tipo: "web app"
//   - redirect uri: http://localhost:8765/pronto
//   - copie o id (embaixo do nome) e o secret para o .env, em REDDIT_ID e REDDIT_SECRET.
//
// O que este programa faz: abre o Reddit no seu navegador, você clica em "Permitir",
// e ele grava REDDIT_REFRESH em .env. A senha da sua conta nunca passa por aqui.
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = join(RAIZ, ".env");
const texto = readFileSync(ENV, "utf8");
const ler = (k) => texto.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";

const ID = ler("REDDIT_ID"), SECRET = ler("REDDIT_SECRET");
if (!ID || !SECRET) {
  console.error("Falta REDDIT_ID ou REDDIT_SECRET no .env. Crie o aplicativo em reddit.com/prefs/apps primeiro.");
  process.exit(1);
}

const PORTA = 8765;
const VOLTA = `http://localhost:${PORTA}/pronto`;
const estado = Math.random().toString(36).slice(2);
const UA = "web:pulsocientifico:v1.0 (by /u/pulsocientifico)";
const autorizar = `https://www.reddit.com/api/v1/authorize?client_id=${ID}&response_type=code&state=${estado}` +
  `&redirect_uri=${encodeURIComponent(VOLTA)}&duration=permanent&scope=submit%20identity%20flair%20read`;

const servidor = createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORTA}`);
  if (!u.pathname.startsWith("/pronto")) { res.writeHead(404); return res.end(); }
  const erro = u.searchParams.get("error");
  const code = u.searchParams.get("code");
  const responder = (msg) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(`<p style="font:16px system-ui">${msg}</p>`); };
  if (erro || u.searchParams.get("state") !== estado || !code) {
    responder("Não deu certo. Volte ao terminal.");
    console.error("recusado ou inválido:", erro ?? "estado não confere");
    servidor.close(); process.exit(1);
  }
  const r = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${ID}:${SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: VOLTA }),
  });
  const d = await r.json();
  if (!d.refresh_token) {
    responder("O Reddit não devolveu a chave. Volte ao terminal.");
    console.error("resposta sem refresh_token:", JSON.stringify(d).slice(0, 200));
    servidor.close(); process.exit(1);
  }
  const novo = /^REDDIT_REFRESH=/m.test(texto)
    ? texto.replace(/^REDDIT_REFRESH=.*$/m, `REDDIT_REFRESH=${d.refresh_token}`)
    : texto.replace(/\n*$/, "\n") + `REDDIT_REFRESH=${d.refresh_token}\n`;
  writeFileSync(ENV, novo, "utf8");
  responder("Pronto! Pode fechar esta aba e voltar ao Claude.");
  console.log("chave gravada no .env (não vou mostrá-la aqui).");
  servidor.close(); process.exit(0);
});

servidor.listen(PORTA, () => {
  console.log("Abrindo o Reddit no seu navegador. Clique em Permitir.");
  console.log("Se não abrir sozinho, cole este endereço:\n" + autorizar);
  exec(`start "" "${autorizar}"`, { shell: "cmd.exe" });
});

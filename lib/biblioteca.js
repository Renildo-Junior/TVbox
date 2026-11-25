'use strict';
// Funções puras (sem Electron) — testadas em test/biblioteca.test.js
const fs = require('fs');
const path = require('path');

const EXT_CAPA = ['.png', '.jpg', '.jpeg', '.webp'];

/** Troca %VAR% pelo valor da variável de ambiente (sem diferenciar maiúsculas). */
function expandirVariaveis(texto, env = process.env) {
  return String(texto).replace(/%([^%]+)%/g, (original, nome) => {
    if (env[nome] !== undefined) return env[nome];
    const chave = Object.keys(env).find((k) => k.toLowerCase() === nome.toLowerCase());
    return chave ? env[chave] : original;
  });
}

/** "Super Mario World (USA) [!].sfc" -> "Super Mario World" */
function nomeLimpo(arquivo) {
  const base = path.basename(arquivo, path.extname(arquivo));
  const limpo = base
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo || base;
}

/** Substitui {chave} em cada argumento. Chaves desconhecidas ficam como estão. */
function montarArgs(modelo, vars) {
  return (modelo || []).map((a) =>
    String(a).replace(/\{(\w+)\}/g, (orig, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : orig))
  );
}

/** true se `arquivo` está dentro de `pasta` (impede abrir arquivo fora da biblioteca). */
function dentroDaPasta(arquivo, pasta) {
  const rel = path.relative(path.resolve(pasta), path.resolve(arquivo));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Primeiro executável existente da lista de candidatos (string ou array). */
function resolverExe(candidatos, existe = fs.existsSync, env = process.env) {
  const lista = (Array.isArray(candidatos) ? candidatos : [candidatos]).filter(Boolean);
  for (const c of lista) {
    const p = expandirVariaveis(c, env);
    if (existe(p)) return p;
  }
  return null;
}

function acharCapa(dir, base, pastaRaiz) {
  const lugares = [dir, path.join(pastaRaiz, 'capas')];
  for (const lugar of lugares) {
    for (const ext of EXT_CAPA) {
      const p = path.join(lugar, base + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/** Arquivos citados dentro de .m3u (discos de jogos multi-CD) — não aparecem soltos na lista. */
function arquivosDeM3u(m3u) {
  try {
    const dir = path.dirname(m3u);
    return fs
      .readFileSync(m3u, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => path.resolve(dir, l).toLowerCase());
  } catch {
    return [];
  }
}

/**
 * Varre a pasta de um sistema e devolve [{ nome, arquivo, capa }] ordenado por nome.
 * Desce até `profundidade` níveis (jogos em subpastas, ex.: um jogo por pasta no PS1).
 */
function escanearPasta(pasta, extensoes, profundidade = 2) {
  const exts = new Set((extensoes || []).map((e) => e.toLowerCase()));
  const achados = [];
  const ocultar = new Set();
  if (!pasta || !fs.existsSync(pasta)) return [];

  const andar = (dir, nivel) => {
    let itens;
    try {
      itens = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (nivel < profundidade && it.name.toLowerCase() !== 'capas') andar(p, nivel + 1);
        continue;
      }
      const ext = path.extname(it.name).toLowerCase();
      if (!exts.has(ext)) continue;
      if (ext === '.m3u') arquivosDeM3u(p).forEach((a) => ocultar.add(a));
      achados.push(p);
    }
  };
  andar(pasta, 0);

  return achados
    .filter((p) => !ocultar.has(path.resolve(p).toLowerCase()))
    .map((p) => ({
      nome: nomeLimpo(p),
      arquivo: p,
      capa: acharCapa(path.dirname(p), path.basename(p, path.extname(p)), pasta),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
}

// ---------- Apps de TV (navegador em modo app, tela cheia) ----------

/** Argumentos do Edge/Chrome para abrir um app de TV. Apps com userAgent próprio ganham perfil separado. */
function argsNavegador(app, perfilBase) {
  const perfil = app.userAgent ? `${perfilBase}-${app.id}` : perfilBase;
  const args = [
    `--user-data-dir=${perfil}`,
    `--app=${app.url}`,
    '--start-fullscreen',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-features=Translate',
  ];
  if (app.userAgent) args.push(`--user-agent=${app.userAgent}`);
  return args;
}

/** Só endereços https: o config não pode virar atalho para abrir programa/arquivo local. */
function urlValida(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------- BIOS ----------

/** Arquivos de BIOS numa pasta (só as extensões aceitas; ignora LEIA-ME). */
function arquivosBios(pasta, extensoes, fsx = fs) {
  const exts = new Set((extensoes || []).map((e) => e.toLowerCase()));
  try {
    return fsx
      .readdirSync(pasta, { withFileTypes: true })
      .filter((d) => d.isFile() && exts.has(path.extname(d.name).toLowerCase()))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Troca marcadores do destino da BIOS: {documentos} e {emu:chave} (pasta do emulador).
 * Devolve null se o emulador citado não está instalado.
 */
function expandirDestino(modelo, vars, dirDoEmulador, env = process.env) {
  let faltou = false;
  const r = expandirVariaveis(modelo, env).replace(/\{(emu:)?(\w+)\}/g, (orig, emu, chave) => {
    if (emu) {
      const d = dirDoEmulador(chave);
      if (!d) faltou = true;
      return d || orig;
    }
    return Object.prototype.hasOwnProperty.call(vars, chave) ? vars[chave] : orig;
  });
  return faltou ? null : r;
}

/**
 * Escolhe com que emulador abrir um jogo do sistema.
 * Se o sistema tem `alternativa` (ex.: PS1 no RetroArch, que roda sem BIOS), ela é usada quando
 * falta o emulador principal ou quando falta a BIOS que ele exige.
 */
function escolherExecucao(s, temExe, temBios) {
  const faltaBios = !!s.bios && !temBios(s.bios);
  const alt = s.alternativa && temExe(s.alternativa.emulador) ? s.alternativa : null;
  if (temExe(s.emulador) && !(faltaBios && alt)) return { emulador: s.emulador, args: s.args, faltaBios };
  if (alt) return { emulador: alt.emulador, args: alt.args || s.args, alternativa: true, faltaBios: false };
  return { erro: `Emulador "${s.emulador}" não encontrado. Rode scripts\\instalar-emuladores.ps1.` };
}

/** Preenche padrões e expande variáveis nas pastas. Chaves que faltam no config do usuário vêm do padrão. */
function normalizarConfig(c, env = process.env, padrao = {}) {
  const cfg = {
    titulo: 'TV Box',
    telaCheia: true,
    iniciarComWindows: false,
    emuladores: {},
    apps: [],
    sistemas: [],
    navegador: [],
    tv: { perfil: '%LOCALAPPDATA%\\TVBox\\navegador', apps: [] },
    bios: [],
    sairSegurandoMs: 1500,
    ...padrao,
    ...c,
  };
  // Cartões de tela interna (ex.: Android TV) vêm sempre do padrão: um config.json criado por versão
  // antiga guardava ali um comando/programa que não existe mais ("o sistema não encontra o arquivo").
  const telas = (padrao.apps || []).filter((a) => a && a.tela);
  if (telas.length) {
    const doUsuario = Array.isArray(cfg.apps) ? cfg.apps : [];
    const apps = doUsuario.map((a) => telas.find((t) => a && t.id === a.id) || a);
    for (const t of telas.slice().reverse()) if (!apps.some((a) => a && a.id === t.id)) apps.unshift(t);
    cfg.apps = apps;
  }
  cfg.tv = { perfil: '%LOCALAPPDATA%\\TVBox\\navegador', apps: [], ...cfg.tv };
  cfg.tv.perfil = expandirVariaveis(cfg.tv.perfil, env);
  cfg.bios = (cfg.bios || []).map((b) => ({ destinos: [], extensoes: ['.bin'], ...b, pasta: expandirVariaveis(b.pasta || '', env) }));
  cfg.sistemas = (cfg.sistemas || []).map((s) => ({
    profundidade: 2,
    args: ['{rom}'],
    ...s,
    pasta: s.pasta ? expandirVariaveis(s.pasta, env) : '',
    extensoes: (s.extensoes || []).map((e) => (e.startsWith('.') ? e : '.' + e).toLowerCase()),
  }));
  return cfg;
}

module.exports = {
  expandirVariaveis,
  nomeLimpo,
  montarArgs,
  dentroDaPasta,
  resolverExe,
  escanearPasta,
  normalizarConfig,
  argsNavegador,
  urlValida,
  arquivosBios,
  expandirDestino,
  escolherExecucao,
};

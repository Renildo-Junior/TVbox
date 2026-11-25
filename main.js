'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const bib = require('./lib/biblioteca');
const controles = require('./lib/controles');

let win = null;
let config = null;
let rodando = null; // programa/emulador aberto no momento
let ponte = null; // ponte do controle (scripts/controle-ponte.ps1) do programa aberto

const TAREFA_ANDROID = 'TVBox\\ReiniciarNoAndroid';

// ---------- configuração ----------
function caminhoConfig() {
  // Modo portátil: um config.json ao lado do .exe tem prioridade.
  const dirPortatil = process.env.PORTABLE_EXECUTABLE_DIR;
  if (dirPortatil) {
    const p = path.join(dirPortatil, 'config.json');
    if (fs.existsSync(p)) return p;
  }
  return path.join(app.getPath('userData'), 'config.json');
}

function carregarConfig() {
  const arquivo = caminhoConfig();
  const textoPadrao = fs.readFileSync(path.join(__dirname, 'config.padrao.json'), 'utf8');
  const padrao = JSON.parse(textoPadrao);
  if (!fs.existsSync(arquivo)) {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, textoPadrao, 'utf8');
  }
  let bruto;
  try {
    bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    dialog.showErrorBox('TV Box', `config.json inválido (${e.message}).\nUsando a configuração padrão.\n\n${arquivo}`);
    bruto = padrao;
  }
  config = bib.normalizarConfig(bruto, process.env, padrao);
  config._arquivo = arquivo;
  if (!config.controles || typeof config.controles !== 'object') config.controles = {};
  escreverMapasPonte();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!config.iniciarComWindows });
  return config;
}

// ---------- controles ----------
function arquivoMapasPonte() {
  return path.join(app.getPath('userData'), 'controles-ponte.txt');
}

/** Mapeamentos salvos -> arquivo lido pela ponte (scripts/controle-ponte.ps1) dentro dos apps. */
function escreverMapasPonte() {
  try {
    fs.mkdirSync(path.dirname(arquivoMapasPonte()), { recursive: true });
    fs.writeFileSync(arquivoMapasPonte(), controles.textoPonte(config.controles), 'utf8');
  } catch { /* sem o arquivo a ponte usa o layout padrão de cada fabricante */ }
}

/** Grava (ou apaga, com mapa = null) o mapeamento de um modelo de controle no config.json do usuário. */
function salvarControle(chave, mapa) {
  const arquivo = caminhoConfig();
  let bruto = {};
  try {
    bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    return { ok: false, erro: `Não consegui ler o config.json (${e.message}).` };
  }
  const atuais = bruto.controles && typeof bruto.controles === 'object' ? bruto.controles : {};
  if (chave === '*') bruto.controles = {};
  else if (mapa) bruto.controles = { ...atuais, [chave]: mapa };
  else {
    delete atuais[chave];
    bruto.controles = atuais;
  }
  try {
    fs.writeFileSync(arquivo, JSON.stringify(bruto, null, 2), 'utf8');
  } catch (e) {
    return { ok: false, erro: `Não consegui gravar o config.json (${e.message}).` };
  }
  config.controles = bruto.controles;
  escreverMapasPonte();
  return { ok: true, controles: config.controles };
}

function mapaValido(m) {
  if (m === null) return true;
  if (!m || typeof m !== 'object' || !m.acoes || typeof m.acoes !== 'object') return false;
  return Object.entries(m.acoes).every(([a, e]) => controles.ACOES.includes(a) && (e === null
    || (e && ['botao', 'eixo', 'hat'].includes(e.tipo) && Number.isInteger(e.i) && e.i >= 0 && e.i < 64)));
}

/** Atalho de teclado global (funciona com o jogo/app na frente) para fechar o que estiver aberto. */
function ligarAtalhoFechar() {
  const atalho = config.atalhoFechar || 'Control+Alt+Backspace';
  try {
    globalShortcut.register(atalho, fecharProgramaAberto);
  } catch { /* atalho inválido no config.json: fica só o Select+Start */ }
}

function exeDoEmulador(chave) {
  return bib.resolverExe(config.emuladores[chave]);
}

function dirDoEmulador(chave) {
  const exe = exeDoEmulador(chave);
  return exe ? path.dirname(exe) : null;
}

function pastaScripts() {
  return app.isPackaged ? path.join(process.resourcesPath, 'scripts') : path.join(__dirname, 'scripts');
}

// ---------- BIOS ----------
function destinosBios(b) {
  return b.destinos
    .map((d) => bib.expandirDestino(d, { documentos: app.getPath('documents') }, dirDoEmulador))
    .filter(Boolean);
}

function temBios(id) {
  const b = config.bios.find((x) => x.id === id);
  if (!b) return true; // sistema sem BIOS configurada: não bloqueia
  return [b.pasta, ...destinosBios(b)].some((p) => bib.arquivosBios(p, b.extensoes).length > 0);
}

/** Copia as BIOS da pasta central (Jogos\bios\<sistema>) para a pasta que cada emulador usa. */
function sincronizarBios() {
  for (const b of config.bios) {
    try {
      fs.mkdirSync(b.pasta, { recursive: true });
    } catch {
      continue;
    }
    const arquivos = bib.arquivosBios(b.pasta, b.extensoes);
    if (!arquivos.length) continue;
    for (const destino of destinosBios(b)) {
      try {
        fs.mkdirSync(destino, { recursive: true });
        for (const nome of arquivos) {
          const de = path.join(b.pasta, nome);
          const para = path.join(destino, nome);
          if (!fs.existsSync(para) || fs.statSync(para).size !== fs.statSync(de).size) fs.copyFileSync(de, para);
        }
      } catch {
        // pasta sem permissão (ex.: Program Files): o emulador usa a outra pasta da lista
      }
    }
  }
}

// ---------- janela ----------
function criarJanela() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: !!config.telaCheia,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f1a',
    title: config.titulo,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  // Nada de navegar para fora nem abrir janelas novas.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function voltarAoLauncher() {
  if (!win) return;
  win.show();
  win.setFullScreen(!!config.telaCheia);
  // O Windows não deixa um programa em segundo plano "roubar" o foco; ficar por cima um instante resolve.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
  win.focus();
  setTimeout(() => win && win.setAlwaysOnTop(false), 800);
  win.webContents.send('voltou');
}

// ---------- execução ----------
/** Fecha o programa aberto: primeiro pede para fechar (salva o que tiver de salvar), depois força. */
function fecharProgramaAberto() {
  const proc = rodando;
  if (!proc) return;
  spawn('taskkill', ['/PID', String(proc.pid), '/T'], { windowsHide: true });
  setTimeout(() => {
    if (rodando === proc) spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true });
  }, 4000);
}

/** Liga a ponte do controle ao programa: Select+Start segurados fecham; com teclado=true o controle vira teclado/mouse. */
function ligarPonte(pid, teclado) {
  const script = path.join(pastaScripts(), 'controle-ponte.ps1');
  if (!fs.existsSync(script)) return;
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
    '-AlvoPid', String(pid), '-SegurarMs', String(config.sairSegurandoMs || 1500), '-Mapas', arquivoMapasPonte()];
  if (teclado) args.push('-Teclado');
  try {
    const p = spawn('powershell.exe', args, { windowsHide: true });
    ponte = p;
    p.once('error', () => { if (ponte === p) ponte = null; });
    p.once('exit', (codigo) => {
      if (ponte === p) ponte = null;
      if (codigo === 10) fecharProgramaAberto();
    });
  } catch {
    ponte = null;
  }
}

function desligarPonte() {
  if (ponte) {
    try { ponte.kill(); } catch { /* já saiu */ }
    ponte = null;
  }
}

function executar(exe, args, opcoes = {}) {
  return new Promise((resolve) => {
    if (rodando) return resolve({ ok: false, erro: 'Já tem um programa aberto.' });
    let proc;
    try {
      proc = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: false });
    } catch (e) {
      return resolve({ ok: false, erro: e.message });
    }
    let iniciou = false;
    proc.once('spawn', () => {
      iniciou = true;
      rodando = proc;
      ligarPonte(proc.pid, !!opcoes.teclado);
      ligarAtalhoFechar();
      win.webContents.send('saiu');
      win.hide(); // o programa assume a tela; o launcher volta quando ele fechar
      resolve({ ok: true });
    });
    proc.once('error', (e) => {
      if (!iniciou) resolve({ ok: false, erro: e.code === 'ENOENT' ? `Não encontrado: ${exe}` : e.message });
    });
    proc.once('exit', () => {
      if (rodando !== proc) return;
      rodando = null;
      desligarPonte();
      globalShortcut.unregisterAll();
      voltarAoLauncher();
    });
  });
}

function rodarComando(arquivo, args) {
  return new Promise((resolve) => {
    const p = spawn(arquivo, args, { windowsHide: true });
    let saida = '';
    p.stdout.on('data', (d) => (saida += d));
    p.stderr.on('data', (d) => (saida += d));
    p.once('error', (e) => resolve({ ok: false, erro: e.message }));
    p.once('exit', (codigo) =>
      resolve(codigo === 0 ? { ok: true } : { ok: false, erro: (saida.trim() || `código ${codigo}`).slice(0, 300) })
    );
  });
}

// ---------- IPC ----------
ipcMain.handle('biblioteca', () => {
  carregarConfig();
  sincronizarBios();
  const avisos = [];
  const apps = config.apps.map((a) => {
    const disponivel = a.tipo !== 'programa' || !!(exeDoEmulador(a.emulador) || bib.resolverExe(a.exe));
    return { id: a.id, nome: a.nome, icone: a.icone || '▶', cor: a.cor || '#30363d', confirmar: a.confirmar || '', tela: a.tela || '', disponivel };
  });
  const temExe = (k) => !!exeDoEmulador(k);
  const sistemas = config.sistemas.map((s) => {
    const jogos = bib.escanearPasta(s.pasta, s.extensoes, s.profundidade).map((j) => ({
      nome: j.nome,
      arquivo: j.arquivo,
      capa: j.capa ? pathToFileURL(j.capa).href : null,
    }));
    if (jogos.length) {
      const e = bib.escolherExecucao(s, temExe, temBios);
      const b = config.bios.find((x) => x.id === s.bios);
      if (e.erro) avisos.push(`${s.nome}: ${e.erro}`);
      else if (e.faltaBios && b) avisos.push(`${s.nome}: falta a BIOS. Copie a BIOS do seu console para ${b.pasta}`);
    }
    return { id: s.id, nome: s.nome, pasta: s.pasta, jogos };
  });
  return { titulo: config.titulo, apps, sistemas, avisos, arquivoConfig: config._arquivo, controles: config.controles };
});

ipcMain.handle('salvar-controle', (_e, chave, mapa) => {
  if (typeof chave !== 'string' || !chave || chave.length > 200) return { ok: false, erro: 'Controle inválido.' };
  if (!mapaValido(mapa)) return { ok: false, erro: 'Mapeamento inválido.' };
  return salvarControle(chave, mapa && { nome: String(mapa.nome || '').slice(0, 200), acoes: mapa.acoes });
});

ipcMain.handle('tv', async () => {
  const consulta = await rodarComando('schtasks', ['/query', '/tn', TAREFA_ANDROID]);
  return {
    navegador: !!bib.resolverExe(config.navegador),
    androidCompleto: consulta.ok,
    apps: config.tv.apps.map((a) => ({ id: a.id, nome: a.nome, icone: a.icone || '▶', cor: a.cor || '#30363d' })),
  };
});

ipcMain.handle('abrir-tv', async (_e, id) => {
  const a = config.tv.apps.find((x) => x.id === id);
  if (!a) return { ok: false, erro: 'App não encontrado.' };
  if (!bib.urlValida(a.url)) return { ok: false, erro: `${a.nome}: o endereço precisa começar com https://` };
  const nav = bib.resolverExe(config.navegador);
  if (!nav) return { ok: false, erro: 'Microsoft Edge ou Google Chrome não encontrado. Ajuste "navegador" no config.json.' };
  return executar(nav, bib.argsNavegador(a, config.tv.perfil), { teclado: a.controle !== 'nativo' });
});

ipcMain.handle('android-completo', () => rodarComando('schtasks', ['/run', '/tn', TAREFA_ANDROID]));

ipcMain.handle('abrir-app', async (_e, id) => {
  const a = config.apps.find((x) => x.id === id);
  if (!a) return { ok: false, erro: 'App não encontrado.' };
  if (a.tipo === 'comando') return rodarComando('cmd.exe', ['/d', '/s', '/c', a.comando]);
  const exe = a.emulador ? exeDoEmulador(a.emulador) : bib.resolverExe(a.exe);
  if (!exe) return { ok: false, erro: `${a.nome}: executável não encontrado. Ajuste o config.json.` };
  return executar(exe, bib.montarArgs(a.args, { dir: path.dirname(exe) }));
});

ipcMain.handle('abrir-jogo', async (_e, idSistema, arquivo) => {
  const s = config.sistemas.find((x) => x.id === idSistema);
  if (!s) return { ok: false, erro: 'Sistema não encontrado.' };
  if (typeof arquivo !== 'string' || !bib.dentroDaPasta(arquivo, s.pasta) || !fs.existsSync(arquivo)) {
    return { ok: false, erro: 'Arquivo do jogo inválido.' };
  }
  const e = bib.escolherExecucao(s, (k) => !!exeDoEmulador(k), temBios);
  if (e.erro) return { ok: false, erro: e.erro };
  const exe = exeDoEmulador(e.emulador);
  return executar(exe, bib.montarArgs(e.args, { rom: arquivo, dir: path.dirname(exe) }));
});

ipcMain.handle('energia', async (_e, acao) => {
  if (acao === 'sair') return app.quit();
  if (acao === 'desligar') return rodarComando('shutdown', ['/s', '/t', '0']);
  if (acao === 'reiniciar') return rodarComando('shutdown', ['/r', '/t', '0']);
  if (acao === 'config') {
    shell.openPath(config._arquivo);
    return { ok: true };
  }
  if (acao === 'pasta-jogos') {
    const ps2 = config.sistemas[0];
    shell.openPath(ps2 ? path.dirname(ps2.pasta) : app.getPath('home'));
    return { ok: true };
  }
  return { ok: false, erro: 'Ação desconhecida.' };
});

// ---------- ciclo de vida ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', voltarAoLauncher);
  app.whenReady().then(() => {
    carregarConfig();
    criarJanela();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', desligarPonte);
  app.on('will-quit', () => globalShortcut.unregisterAll());
}

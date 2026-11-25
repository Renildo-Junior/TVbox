'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bib = require('../lib/biblioteca');

const padrao = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.padrao.json'), 'utf8'));

test('apps de TV do padrão: https, ids únicos, YouTube/Netflix/Spotify presentes', () => {
  const ids = padrao.tv.apps.map((a) => a.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const id of ['youtube', 'netflix', 'spotify']) assert.ok(ids.includes(id), id);
  for (const a of padrao.tv.apps) assert.ok(bib.urlValida(a.url), a.url);
  const android = padrao.apps.find((a) => a.id === 'androidtv');
  assert.strictEqual(android.tela, 'tv');
});

test('urlValida só aceita https', () => {
  assert.ok(bib.urlValida('https://www.netflix.com'));
  assert.ok(!bib.urlValida('http://x.com'));
  assert.ok(!bib.urlValida('file:///C:/Windows/notepad.exe'));
  assert.ok(!bib.urlValida('C:\\Windows\\notepad.exe'));
  assert.ok(!bib.urlValida(undefined));
});

test('argsNavegador: perfil próprio e user-agent só quando o app define', () => {
  const yt = bib.argsNavegador({ id: 'youtube', url: 'https://www.youtube.com/tv', userAgent: 'UA TV' }, 'C:\\P\\nav');
  assert.ok(yt.includes('--user-data-dir=C:\\P\\nav-youtube'));
  assert.ok(yt.includes('--app=https://www.youtube.com/tv'));
  assert.ok(yt.includes('--user-agent=UA TV'));
  assert.ok(yt.includes('--start-fullscreen'));
  const nf = bib.argsNavegador({ id: 'netflix', url: 'https://www.netflix.com' }, 'C:\\P\\nav');
  assert.ok(nf.includes('--user-data-dir=C:\\P\\nav'));
  assert.ok(!nf.some((a) => a.startsWith('--user-agent')));
});

test('normalizarConfig completa chaves que faltam com o padrão', () => {
  const env = { USERPROFILE: 'C:\\Users\\tv', LOCALAPPDATA: 'C:\\Users\\tv\\AppData\\Local' };
  const antigo = { apps: [], sistemas: [] }; // config.json criado antes de existir "tv" e "bios"
  const cfg = bib.normalizarConfig(antigo, env, padrao);
  assert.ok(cfg.tv.apps.length >= 3);
  assert.strictEqual(cfg.tv.perfil, 'C:\\Users\\tv\\AppData\\Local\\TVBox\\navegador');
  assert.deepStrictEqual(cfg.bios.map((b) => b.id), ['ps1', 'ps2', 'arcade']);
  assert.strictEqual(cfg.bios[1].pasta, 'C:\\Users\\tv\\Jogos\\bios\\ps2');
});

test('normalizarConfig troca o cartão Android TV antigo pela tela de TV e mantém os outros apps', () => {
  const antigo = {
    apps: [
      { id: 'androidtv', nome: 'Android TV', tipo: 'comando', comando: 'start "" "C:\\BlissOS\\nao-existe.exe"' },
      { id: 'meu', nome: 'Meu app', tipo: 'programa', exe: 'C:\\x.exe' },
    ],
  };
  const cfg = bib.normalizarConfig(antigo, {}, padrao);
  const android = cfg.apps.find((a) => a.id === 'androidtv');
  assert.strictEqual(android.tipo, 'tela');
  assert.strictEqual(android.tela, 'tv');
  assert.ok(cfg.apps.some((a) => a.id === 'meu'));
  // config sem o cartão: ele volta, em primeiro
  const semCartao = bib.normalizarConfig({ apps: [{ id: 'meu', nome: 'Meu', tipo: 'programa' }] }, {}, padrao);
  assert.strictEqual(semCartao.apps[0].id, 'androidtv');
});

test('expandirDestino: {documentos}, {emu:x} e emulador ausente', () => {
  const dirs = { retroarch: 'C:\\RA' };
  const dir = (k) => dirs[k] || null;
  assert.strictEqual(bib.expandirDestino('{emu:retroarch}\\system', {}, dir, {}), 'C:\\RA\\system');
  assert.strictEqual(bib.expandirDestino('{documentos}\\PCSX2\\bios', { documentos: 'D:\\Docs' }, dir, {}), 'D:\\Docs\\PCSX2\\bios');
  assert.strictEqual(bib.expandirDestino('{emu:pcsx2}\\bios', {}, dir, {}), null);
});

test('arquivosBios filtra por extensão e ignora LEIA-ME', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'tvbox-bios-'));
  try {
    fs.writeFileSync(path.join(raiz, 'SCPH1001.BIN'), 'x');
    fs.writeFileSync(path.join(raiz, 'LEIA-ME.txt'), 'x');
    fs.mkdirSync(path.join(raiz, 'sub.bin'));
    assert.deepStrictEqual(bib.arquivosBios(raiz, ['.bin']), ['SCPH1001.BIN']);
    assert.deepStrictEqual(bib.arquivosBios(path.join(raiz, 'nada'), ['.bin']), []);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('escolherExecucao: PS1 sem BIOS vai para o RetroArch; com BIOS, DuckStation', () => {
  const ps1 = padrao.sistemas.find((s) => s.id === 'ps1');
  const todos = () => true;
  assert.strictEqual(bib.escolherExecucao(ps1, todos, () => true).emulador, 'duckstation');
  const semBios = bib.escolherExecucao(ps1, todos, () => false);
  assert.strictEqual(semBios.emulador, 'retroarch');
  assert.ok(semBios.args.some((a) => a.includes('pcsx_rearmed')));
  // sem DuckStation instalado também cai no RetroArch
  assert.strictEqual(bib.escolherExecucao(ps1, (k) => k === 'retroarch', () => true).emulador, 'retroarch');
  // PS2 sem BIOS: abre o PCSX2 mesmo assim, mas avisa
  const ps2 = padrao.sistemas.find((s) => s.id === 'ps2');
  const r = bib.escolherExecucao(ps2, todos, () => false);
  assert.strictEqual(r.emulador, 'pcsx2');
  assert.strictEqual(r.faltaBios, true);
  assert.ok(bib.escolherExecucao(ps2, () => false, () => true).erro);
});

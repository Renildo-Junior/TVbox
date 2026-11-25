'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bib = require('../lib/biblioteca');

test('nomeLimpo tira extensão e tags de região/versão', () => {
  assert.strictEqual(bib.nomeLimpo('C:\\j\\Super Mario World (USA) [!].sfc'), 'Super Mario World');
  assert.strictEqual(bib.nomeLimpo('God_of_War (Europe, Australia) (En,Fr).iso'), 'God of War');
  assert.strictEqual(bib.nomeLimpo('(Beta).nes'), '(Beta)');
});

test('montarArgs substitui chaves conhecidas e preserva as outras', () => {
  const r = bib.montarArgs(['-L', '{dir}\\cores\\x.dll', '{rom}', '{outra}'], { rom: 'C:\\a b.sfc', dir: 'C:\\RA' });
  assert.deepStrictEqual(r, ['-L', 'C:\\RA\\cores\\x.dll', 'C:\\a b.sfc', '{outra}']);
  assert.deepStrictEqual(bib.montarArgs(undefined, {}), []);
});

test('dentroDaPasta bloqueia arquivo fora da biblioteca', () => {
  assert.ok(bib.dentroDaPasta('C:\\Jogos\\ps2\\a.iso', 'C:\\Jogos\\ps2'));
  assert.ok(bib.dentroDaPasta('C:\\Jogos\\ps2\\sub\\a.iso', 'C:\\Jogos\\ps2'));
  assert.ok(!bib.dentroDaPasta('C:\\Jogos\\ps2\\..\\..\\Windows\\x.exe', 'C:\\Jogos\\ps2'));
  assert.ok(!bib.dentroDaPasta('C:\\Jogos\\ps2', 'C:\\Jogos\\ps2'));
  assert.ok(!bib.dentroDaPasta('D:\\outro.iso', 'C:\\Jogos\\ps2'));
});

test('expandirVariaveis e resolverExe', () => {
  const env = { USERPROFILE: 'C:\\Users\\tv', AppData: 'C:\\AD' };
  assert.strictEqual(bib.expandirVariaveis('%USERPROFILE%\\Jogos', env), 'C:\\Users\\tv\\Jogos');
  assert.strictEqual(bib.expandirVariaveis('%APPDATA%\\x', env), 'C:\\AD\\x');
  assert.strictEqual(bib.expandirVariaveis('%NADA%\\x', env), '%NADA%\\x');
  const existe = (p) => p === 'C:\\AD\\RetroArch\\retroarch.exe';
  assert.strictEqual(bib.resolverExe(['C:\\nao.exe', '%APPDATA%\\RetroArch\\retroarch.exe'], existe, env), 'C:\\AD\\RetroArch\\retroarch.exe');
  assert.strictEqual(bib.resolverExe('C:\\nao.exe', existe, env), null);
  assert.strictEqual(bib.resolverExe(undefined, existe, env), null);
});

test('escanearPasta: extensões, subpastas, capas, m3u e ordenação', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'tvbox-'));
  try {
    const f = (rel, conteudo = '') => {
      const p = path.join(raiz, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, conteudo);
      return p;
    };
    f('zelda (USA).sfc');
    f('Aladdin.SFC');
    f('leia-me.txt');
    f('capas\\Aladdin.png');
    f('FF7\\FF7 (Disc 1).cue');
    f('FF7\\FF7 (Disc 2).cue');
    f('FF7\\FF7.m3u', 'FF7 (Disc 1).cue\nFF7 (Disc 2).cue\n');
    f('a\\b\\c\\fundo.sfc'); // além da profundidade 2

    const jogos = bib.escanearPasta(raiz, ['.sfc', '.cue', '.m3u'], 2);
    assert.deepStrictEqual(jogos.map((j) => j.nome), ['Aladdin', 'FF7', 'zelda']);
    assert.ok(jogos[0].capa && jogos[0].capa.endsWith('Aladdin.png'));
    assert.strictEqual(jogos[2].capa, null);
    assert.deepStrictEqual(bib.escanearPasta(path.join(raiz, 'nao-existe'), ['.sfc']), []);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('config padrão é JSON válido e normaliza', () => {
  const bruto = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.padrao.json'), 'utf8'));
  const cfg = bib.normalizarConfig(bruto, { USERPROFILE: 'C:\\Users\\tv' });
  assert.ok(cfg.apps.some((a) => a.id === 'androidtv'));
  const ps2 = cfg.sistemas.find((s) => s.id === 'ps2');
  assert.strictEqual(ps2.pasta, 'C:\\Users\\tv\\Jogos\\ps2');
  assert.ok(ps2.args.includes('{rom}'));
  for (const s of cfg.sistemas) {
    assert.ok(cfg.emuladores[s.emulador], `emulador ${s.emulador} sem caminho`);
    assert.ok(s.extensoes.every((e) => e.startsWith('.') && e === e.toLowerCase()));
  }
});

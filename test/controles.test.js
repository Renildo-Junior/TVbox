'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../lib/controles');

const PARADO = 3.2857; // hat parado no Chromium
function pad({ id = 'X', mapping = '', botoes = [], eixos = [0, 0, 0, 0, 0, 0, 0, 0, 0, PARADO], n = 16 } = {}) {
  return {
    id, mapping, axes: eixos.slice(),
    buttons: Array.from({ length: n }, (_, i) => ({ pressed: botoes.includes(i), value: botoes.includes(i) ? 1 : 0 })),
  };
}

test('idUsb e chave a partir do id do Chromium', () => {
  const id = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09CC)';
  assert.deepStrictEqual(C.idUsb(id), { vid: '054c', pid: '09cc' });
  assert.strictEqual(C.chave(id), '054c:09cc');
  assert.strictEqual(C.chave('Controle sem vendor'), 'Controle sem vendor');
  assert.strictEqual(C.idUsb(undefined), null);
});

test('controle "standard": A=0, Start=9, D-pad 12..15 e analógico esquerdo como direção', () => {
  const a = C.lerAcoes(pad({ mapping: 'standard', botoes: [0, 9, 12] }), {});
  assert.ok(a.A && a.START && a.cima);
  assert.ok(!a.B && !a.baixo);
  const s = C.lerAcoes(pad({ mapping: 'standard', eixos: [0.9, 0] }), {});
  assert.ok(s.dir && !s.esq);
});

test('controle genérico (não reconhecido): layout pelo fabricante e D-pad no hat', () => {
  const sony = pad({ id: 'X (Vendor: 054c Product: 05c4)', botoes: [1] });
  assert.strictEqual(C.mapaDe(sony, {}).origem, 'playstation');
  assert.ok(C.lerAcoes(sony, {}).A, '✕ (botão 1) é o A no layout Sony');
  const gen = pad({ id: 'USB Gamepad (Vendor: 0079 Product: 0006)', botoes: [2], eixos: [0, 0, 0, 0, 0, 0, 0, 0, 0, -1] });
  const a = C.lerAcoes(gen, {});
  assert.ok(a.A && a.cima && !a.baixo);
});

test('direcoesHat: 8 posições e parado', () => {
  assert.deepStrictEqual(C.direcoesHat(-1), ['cima']);
  assert.deepStrictEqual(C.direcoesHat(-0.4286), ['dir']);
  assert.deepStrictEqual(C.direcoesHat(0.1429), ['baixo']);
  assert.deepStrictEqual(C.direcoesHat(0.7143), ['esq']);
  assert.deepStrictEqual(C.direcoesHat(1), ['cima', 'esq']);
  assert.deepStrictEqual(C.direcoesHat(PARADO), []);
});

test('mapeamento salvo pelo usuário tem prioridade', () => {
  const id = 'Joy (Vendor: 1234 Product: abcd)';
  const salvos = { '1234:abcd': { acoes: { ...C.LAYOUTS.generico, A: { tipo: 'botao', i: 7 }, cima: { tipo: 'eixo', i: 1, sinal: -1 } } } };
  const a = C.lerAcoes(pad({ id, botoes: [7], eixos: [0, -1] }), salvos);
  assert.ok(a.A && a.cima);
  assert.ok(!C.lerAcoes(pad({ id, botoes: [2] }), salvos).A, 'o botão 2 deixou de ser A');
});

test('detectar: botão novo, hat, eixo; repouso', () => {
  const base = C.foto(pad());
  assert.strictEqual(C.detectar(base, pad()), null);
  assert.ok(C.emRepouso(base, pad()));
  assert.deepStrictEqual(C.detectar(base, pad({ botoes: [5] })), { tipo: 'botao', i: 5 });
  assert.deepStrictEqual(C.detectar(base, pad({ eixos: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7143] })), { tipo: 'hat', i: 9, dir: 'esq' });
  assert.deepStrictEqual(C.detectar(base, pad({ eixos: [0, 0.9] })), { tipo: 'eixo', i: 1, sinal: 1 });
  // gatilho que descansa em -1: só conta quando vai para +1
  const baseGat = C.foto(pad({ eixos: [0, 0, -1] }));
  assert.strictEqual(C.detectar(baseGat, pad({ eixos: [0, 0, -1] })), null);
  assert.deepStrictEqual(C.detectar(baseGat, pad({ eixos: [0, 0, 1] })), { tipo: 'eixo', i: 2, sinal: 1 });
});

test('textoPonte: uma linha por modelo vid:pid, no formato da ponte', () => {
  const salvos = {
    '054c:05c4': { acoes: { ...C.LAYOUTS.playstation } },
    '0079:0006': { acoes: { ...C.LAYOUTS.generico, cima: { tipo: 'eixo', i: 1, sinal: -1 }, LT: null } },
    'sem vendor': { acoes: {} },
  };
  const linhas = C.textoPonte(salvos).trim().split(/\r?\n/).filter((l) => !l.startsWith('#'));
  assert.strictEqual(linhas.length, 2);
  assert.match(linhas[0], /^054c:05c4 A=1 B=2 X=0 Y=3 .*SELECT=8 START=9 .*CIMA=pov BAIXO=pov ESQ=pov DIR=pov$/);
  assert.match(linhas[1], /CIMA=y- /);
  assert.match(linhas[1], / LT=-1 /);
});

test('todas as ações têm nome e estão nos layouts', () => {
  for (const a of C.ACOES) {
    assert.ok(C.NOMES[a], a);
    assert.ok(a in C.PADRAO, a);
    for (const l of Object.values(C.LAYOUTS)) assert.ok(a in l, a);
  }
});

/* Controles: leitura de QUALQUER controle (padrão Xbox/PS ou genérico) e mapeamento configurável.
 * Usado pela tela (window.TVControles) e pelos testes (require). Sem Electron, sem DOM. */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.TVControles = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Ordem em que a tela "Configurar controle" pede cada botão.
  const ACOES = ['cima', 'baixo', 'esq', 'dir', 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SELECT', 'START', 'L3', 'R3'];

  const NOMES = {
    cima: 'D-pad CIMA', baixo: 'D-pad BAIXO', esq: 'D-pad ESQUERDA', dir: 'D-pad DIREITA',
    A: 'A / ✕  (confirmar)', B: 'B / ◯  (voltar)', X: 'X / ▢', Y: 'Y / △',
    LB: 'LB / L1', RB: 'RB / R1', LT: 'LT / L2', RT: 'RT / R2',
    SELECT: 'SELECT / Back / Share', START: 'START / Options', L3: 'L3 (apertar analógico esquerdo)', R3: 'R3 (apertar analógico direito)',
  };

  const b = (i) => ({ tipo: 'botao', i });
  const hat = (dir) => ({ tipo: 'hat', i: 9, dir });

  // Layout "standard" da Gamepad API (Xbox, PS4/PS5 e tudo que o Chromium reconhece).
  const PADRAO = {
    cima: b(12), baixo: b(13), esq: b(14), dir: b(15), A: b(0), B: b(1), X: b(2), Y: b(3),
    LB: b(4), RB: b(5), LT: b(6), RT: b(7), SELECT: b(8), START: b(9), L3: b(10), R3: b(11),
  };

  // Layouts "crus" (controle não reconhecido pelo Chromium; mesma numeração do WinMM/DirectInput).
  const LAYOUTS = {
    // Sony via DirectInput: ▢0 ✕1 ◯2 △3 L1 4 R1 5 L2 6 R2 7 Share 8 Options 9 L3 10 R3 11, D-pad no hat.
    playstation: { cima: hat('cima'), baixo: hat('baixo'), esq: hat('esq'), dir: hat('dir'), A: b(1), B: b(2), X: b(0), Y: b(3),
      LB: b(4), RB: b(5), LT: b(6), RT: b(7), SELECT: b(8), START: b(9), L3: b(10), R3: b(11) },
    // Xbox/XInput via DirectInput: A0 B1 X2 Y3 LB4 RB5 Back6 Start7 L3 8 R3 9.
    xbox: { cima: hat('cima'), baixo: hat('baixo'), esq: hat('esq'), dir: hat('dir'), A: b(0), B: b(1), X: b(2), Y: b(3),
      LB: b(4), RB: b(5), LT: null, RT: null, SELECT: b(6), START: b(7), L3: b(8), R3: b(9) },
    // Genérico USB (o mais comum: △0 ◯1 ✕2 ▢3 L1 4 R1 5 L2 6 R2 7 Select 8 Start 9). Se não bater, configure.
    generico: { cima: hat('cima'), baixo: hat('baixo'), esq: hat('esq'), dir: hat('dir'), A: b(2), B: b(1), X: b(3), Y: b(0),
      LB: b(4), RB: b(5), LT: b(6), RT: b(7), SELECT: b(8), START: b(9), L3: b(10), R3: b(11) },
  };

  /** "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)" -> { vid: '054c', pid: '09cc' } */
  function idUsb(id) {
    const m = /Vendor:\s*([0-9a-f]{4})\s*Product:\s*([0-9a-f]{4})/i.exec(String(id || ''));
    if (m) return { vid: m[1].toLowerCase(), pid: m[2].toLowerCase() };
    const n = /^([0-9a-f]{4})-([0-9a-f]{4})-/i.exec(String(id || '')); // formato do Firefox
    return n ? { vid: n[1].toLowerCase(), pid: n[2].toLowerCase() } : null;
  }

  /** Chave do controle no config.json: "vid:pid" (o mesmo modelo usa o mesmo mapeamento) ou o próprio id. */
  function chave(id) {
    const u = idUsb(id);
    return u ? `${u.vid}:${u.pid}` : String(id || '');
  }

  function layoutPorFabricante(vid) {
    if (vid === '054c') return 'playstation';
    if (vid === '045e') return 'xbox';
    return 'generico';
  }

  /** Mapeamento efetivo: o salvo pelo usuário > layout padrão (standard) > layout pelo fabricante. */
  function mapaDe(gp, salvos) {
    const s = salvos && salvos[chave(gp.id)];
    if (s && s.acoes) return { origem: 'usuario', acoes: s.acoes };
    if (gp.mapping === 'standard') return { origem: 'standard', acoes: PADRAO };
    const u = idUsb(gp.id);
    const nome = layoutPorFabricante(u && u.vid);
    return { origem: nome, acoes: LAYOUTS[nome] };
  }

  /** Hat (POV) no Chromium: um eixo de -1 a 1 em 8 passos; parado fica fora da faixa (~3,29). */
  function direcoesHat(v) {
    if (typeof v !== 'number' || v < -1.05 || v > 1.05) return [];
    const k = ((Math.round((v + 1) / (2 / 7)) % 8) + 8) % 8;
    return [['cima'], ['cima', 'dir'], ['dir'], ['baixo', 'dir'], ['baixo'], ['baixo', 'esq'], ['esq'], ['cima', 'esq']][k];
  }

  const apertado = (x) => !!x && (typeof x === 'object' ? x.pressed || x.value > 0.5 : x === 1);

  function ativa(gp, e) {
    if (!e) return false;
    if (e.tipo === 'botao') return apertado(gp.buttons[e.i]);
    const v = gp.axes[e.i];
    if (typeof v !== 'number') return false;
    if (e.tipo === 'eixo') return v * e.sinal > 0.5;
    if (e.tipo === 'hat') return direcoesHat(v).includes(e.dir);
    return false;
  }

  /** Estado de todas as ações num controle. O analógico esquerdo (eixos 0/1) sempre ajuda nas direções. */
  function lerAcoes(gp, salvos) {
    const { acoes } = mapaDe(gp, salvos);
    const r = {};
    for (const a of ACOES) r[a] = ativa(gp, acoes[a]);
    // Se o usuário pôs os eixos 0/1 em outro botão (ex.: gatilho), não usa como direção.
    const eixo01EmOutraAcao = Object.entries(acoes).some(([a, e]) =>
      e && e.tipo === 'eixo' && (e.i === 0 || e.i === 1) && !['cima', 'baixo', 'esq', 'dir'].includes(a));
    if (!eixo01EmOutraAcao) {
      const [x = 0, y = 0] = gp.axes;
      r.cima = r.cima || y < -0.5;
      r.baixo = r.baixo || y > 0.5;
      r.esq = r.esq || x < -0.5;
      r.dir = r.dir || x > 0.5;
    }
    return r;
  }

  /** Foto do controle parado (base para detectar o que mudou na configuração). */
  function foto(gp) {
    return { botoes: gp.buttons.map(apertado), eixos: gp.axes.slice() };
  }

  /** Primeira entrada que mudou em relação à foto: botão novo, hat ou eixo movido. null se nada. */
  function detectar(base, gp) {
    for (let i = 0; i < gp.buttons.length; i++) {
      if (apertado(gp.buttons[i]) && !base.botoes[i]) return { tipo: 'botao', i };
    }
    for (let i = 0; i < gp.axes.length; i++) {
      const v = gp.axes[i];
      const v0 = base.eixos[i];
      if (typeof v !== 'number' || typeof v0 !== 'number') continue;
      if (Math.abs(v0) > 1.05) { // hat parado
        const d = direcoesHat(v);
        if (d.length === 1) return { tipo: 'hat', i, dir: d[0] };
        continue;
      }
      if (Math.abs(v - v0) > 0.6 && Math.abs(v) > 0.5) return { tipo: 'eixo', i, sinal: v > 0 ? 1 : -1 };
    }
    return null;
  }

  /** Tudo solto de novo (para esperar soltar entre um passo e outro). */
  function emRepouso(base, gp) {
    return detectar(base, gp) === null;
  }

  function descrever(e) {
    if (!e) return '—';
    if (e.tipo === 'botao') return `botão ${e.i}`;
    if (e.tipo === 'hat') return `direcional ${e.dir}`;
    return `eixo ${e.i}${e.sinal > 0 ? '+' : '−'}`;
  }

  /* ---------- ponte (scripts/controle-ponte.ps1) ----------
   * Fora do TV Box (dentro do app/emulador) o controle é lido pelo WinMM. Para cada modelo configurado,
   * uma linha:  vid:pid A=1 B=2 ... CIMA=pov|x-|y+|<botão>  (-1 = sem). */
  const ACOES_PONTE = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SELECT', 'START', 'L3', 'R3', 'CIMA', 'BAIXO', 'ESQ', 'DIR'];

  function valorPonte(e, direcao) {
    if (!e) return '-1';
    if (e.tipo === 'botao') return String(e.i);
    if (direcao && e.tipo === 'hat') return 'pov';
    if (direcao && e.tipo === 'eixo' && (e.i === 0 || e.i === 1)) return `${e.i === 0 ? 'x' : 'y'}${e.sinal > 0 ? '+' : '-'}`;
    return '-1';
  }

  function textoPonte(salvos) {
    const linhas = ['# gerado pelo TV Box (Sistema > Configurar controle). Não edite à mão.'];
    for (const [k, m] of Object.entries(salvos || {})) {
      if (!/^[0-9a-f]{4}:[0-9a-f]{4}$/.test(k) || !m || !m.acoes) continue;
      const partes = ACOES_PONTE.map((a) => {
        const nome = { CIMA: 'cima', BAIXO: 'baixo', ESQ: 'esq', DIR: 'dir' }[a] || a;
        return `${a}=${valorPonte(m.acoes[nome], nome !== a)}`;
      });
      linhas.push(`${k} ${partes.join(' ')}`);
    }
    return linhas.join('\r\n') + '\r\n';
  }

  return { ACOES, NOMES, PADRAO, LAYOUTS, idUsb, chave, mapaDe, direcoesHat, lerAcoes, foto, detectar, emRepouso, descrever, textoPonte };
});

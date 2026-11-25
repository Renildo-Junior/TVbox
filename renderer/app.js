'use strict';
/* Tela do TV Box. Teclado, QUALQUER controle e mouse chamam os mesmos comandos (função comando()). */

const el = (id) => document.getElementById(id);
const C = window.TVControles;

// tela: 'inicio' (apps + jogos) ou 'tv' (apps de TV). pausado: tem um app/emulador aberto por cima.
const estado = {
  tela: 'inicio', linhas: [], l: 0, c: [], modal: null, ocupado: false, pausado: false, posInicio: null,
  ajuda: false, captura: null, controles: {},
};

// ---------- tabela de comandos (é também o conteúdo da tela de Ajuda) ----------
// [comando, descrição, botões do controle, teclas]
const COMANDOS = [
  ['mover', 'Navegar', 'D-pad ou analógico esquerdo', 'Setas ou W A S D'],
  ['ok', 'Abrir / confirmar', 'A (✕ no PlayStation)', 'Enter ou Espaço'],
  ['voltar', 'Voltar / cancelar', 'B (◯)', 'Esc ou Backspace'],
  ['ajuda', 'Esta ajuda', 'X (▢) ou Select', 'F1 ou H'],
  ['atualizar', 'Atualizar a lista de jogos', 'Y (△)', 'F5 ou R'],
  ['sistema', 'Menu Sistema (desligar, controle, config.)', 'Start', 'M, F10 ou tecla Menu'],
  ['pagina', 'Pular 5 cartões', 'LB / RB (L1 / R1)', 'Page Up / Page Down'],
  ['ponta', 'Início / fim da linha', 'LT / RT (L2 / R2)', 'Home / End'],
  ['linha', 'Linha anterior / próxima', '—', 'Shift+Tab / Tab'],
  ['controle', 'Configurar controle', 'Sistema → Configurar controle', 'F2'],
  ['tela', 'Tela cheia liga/desliga', '—', 'F11'],
  ['fechar', 'Fechar o jogo/app aberto e voltar', 'Segure Select + Start', 'Ctrl + Alt + Backspace'],
];
const NO_APP = [
  ['Dentro dos apps de TV (YouTube, Netflix, Spotify...)', ''],
  ['D-pad', 'setas'], ['A', 'Enter'], ['B', 'Esc'], ['Y', 'Espaço (play/pause)'], ['X', 'clique do mouse'],
  ['Analógico esquerdo', 'mouse'], ['Analógico direito', 'rolar a página'], ['LB / RB', 'Shift+Tab / Tab'],
  ['LT / RT', 'volume − / +'], ['Select (sozinho)', 'página anterior'], ['R3 (apertar analógico direito)', 'teclado na tela'],
];

const RODAPE = [['A', 'Enter', 'abrir'], ['B', 'Esc', 'voltar'], ['X', 'F1', 'ajuda'], ['Start', 'M', 'sistema']];
function desenharRodape() {
  const f = el('rodape');
  f.textContent = '';
  const itens = estado.tela === 'tv'
    ? [...RODAPE.slice(0, 3), ['Select+Start', 'Ctrl+Alt+⌫', 'dentro do app: voltar aqui']]
    : RODAPE;
  for (const [botao, tecla, texto] of itens) {
    const s = document.createElement('span');
    const b = document.createElement('b');
    b.className = 'tecla';
    b.textContent = botao;
    const k = document.createElement('b');
    k.className = 'tecla teclado';
    k.textContent = tecla;
    s.append(b, ' ', k, ` ${texto}`);
    f.appendChild(s);
  }
}

// ---------- avisos e confirmação ----------
let timerAviso;
function avisar(texto, ok = false) {
  const a = el('aviso');
  a.textContent = texto;
  a.className = ok ? 'ok' : '';
  a.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => (a.hidden = true), 6000);
}

function confirmar(texto) {
  return new Promise((resolve) => {
    el('modal-texto').textContent = texto;
    el('modal').hidden = false;
    estado.modal = { escolha: 1, resolve }; // começa no "Não" por segurança
    pintarModal();
  });
}
function pintarModal() {
  el('modal-sim').classList.toggle('foco', estado.modal.escolha === 0);
  el('modal-nao').classList.toggle('foco', estado.modal.escolha === 1);
}
function fecharModal(sim) {
  const m = estado.modal;
  estado.modal = null;
  el('modal').hidden = true;
  m.resolve(sim);
}
el('modal-sim').addEventListener('click', () => estado.modal && fecharModal(true));
el('modal-nao').addEventListener('click', () => estado.modal && fecharModal(false));

// ---------- ajuda ----------
function abrirAjuda() {
  const t = el('ajuda-tabela');
  t.textContent = '';
  const cab = document.createElement('tr');
  for (const x of ['Função', 'Controle', 'Teclado']) {
    const th = document.createElement('th');
    th.textContent = x;
    cab.appendChild(th);
  }
  t.appendChild(cab);
  for (const [, desc, ctrl, tecla] of COMANDOS) {
    const tr = document.createElement('tr');
    for (const x of [desc, ctrl, tecla]) {
      const td = document.createElement('td');
      td.textContent = x;
      tr.appendChild(td);
    }
    t.appendChild(tr);
  }
  const lista = el('ajuda-app');
  lista.textContent = '';
  for (const [a, b] of NO_APP) {
    const li = document.createElement(b ? 'li' : 'h3');
    li.textContent = b ? `${a} → ${b}` : a;
    lista.appendChild(li);
  }
  el('ajuda').hidden = false;
  estado.ajuda = true;
}
function fecharAjuda() {
  el('ajuda').hidden = true;
  estado.ajuda = false;
}
el('ajuda').addEventListener('click', fecharAjuda);

// ---------- montagem das linhas ----------
async function carregar() {
  if (estado.tela === 'tv') return carregarTv();
  const dados = await window.tvbox.biblioteca();
  document.title = dados.titulo;
  el('titulo').textContent = dados.titulo;
  estado.controles = dados.controles || {};
  pintarLateral(dados);

  const linhas = [];
  linhas.push({
    titulo: 'Início',
    app: true,
    itens: dados.apps.map((a) => ({
      nome: a.nome, icone: a.icone, cor: a.cor, indisponivel: !a.disponivel,
      acao: async () => {
        if (a.tela) return abrirTela(a.tela);
        if (a.confirmar && !(await confirmar(a.confirmar))) return;
        return window.tvbox.abrirApp(a.id);
      },
    })),
  });

  const comJogos = dados.sistemas.filter((s) => s.jogos.length);
  for (const s of comJogos) {
    linhas.push({
      titulo: `${s.nome} · ${s.jogos.length}`,
      itens: s.jogos.map((j) => ({ nome: j.nome, capa: j.capa, acao: () => window.tvbox.abrirJogo(s.id, j.arquivo) })),
    });
  }

  linhas.push({
    titulo: 'Sistema',
    app: true,
    sistema: true,
    itens: [
      { nome: 'Atualizar lista', icone: '🔄', acao: async () => { await carregar(); return { ok: true, msg: 'Lista atualizada.' }; } },
      { nome: 'Comandos (ajuda)', icone: '❔', acao: () => abrirAjuda() },
      { nome: 'Configurar controle', icone: '🎮', acao: () => abrirCaptura() },
      { nome: 'Controles: voltar ao padrão', icone: '♻️', acao: async () =>
        (await confirmar('Apagar os mapeamentos de controle salvos e voltar ao padrão?')) && salvarControle('*', null) },
      { nome: 'Pasta dos jogos', icone: '📁', acao: () => window.tvbox.energia('pasta-jogos') },
      { nome: 'Configuração', icone: '⚙️', acao: () => window.tvbox.energia('config') },
      { nome: 'Sair para o Windows', icone: '🪟', acao: () => window.tvbox.energia('sair') },
      { nome: 'Reiniciar', icone: '🔁', acao: async () => (await confirmar('Reiniciar o computador?')) && window.tvbox.energia('reiniciar') },
      { nome: 'Desligar', icone: '⏻', acao: async () => (await confirmar('Desligar o computador?')) && window.tvbox.energia('desligar') },
    ],
  });

  aplicarLinhas(linhas);
  desenhar(dados, comJogos.length === 0);
  if (dados.avisos.length) avisar(dados.avisos.join('  •  '));
}

function aplicarLinhas(linhas) {
  estado.linhas = linhas;
  estado.l = Math.max(0, Math.min(estado.l, linhas.length - 1));
  estado.c = linhas.map((_, i) => Math.max(0, Math.min(estado.c[i] || 0, linhas[i].itens.length - 1)));
}

// ---------- tela de TV (apps de streaming) ----------
async function carregarTv() {
  const tv = await window.tvbox.tv();
  el('titulo').textContent = 'Android TV';
  const linhas = [{
    titulo: 'Apps',
    app: true,
    itens: tv.apps.map((a) => ({
      nome: a.nome, icone: a.icone, cor: a.cor, indisponivel: !tv.navegador,
      acao: () => window.tvbox.abrirTv(a.id),
    })),
  }];
  const mais = [{ nome: 'Voltar', icone: '⬅️', acao: () => abrirTela('inicio') }];
  if (tv.androidCompleto) {
    mais.push({
      nome: 'Android completo (reiniciar)', icone: '🤖', cor: '#3ddc84',
      acao: async () => (await confirmar('O computador vai reiniciar no Android. Para voltar ao TV Box, reinicie pelo Android. Continuar?'))
        && window.tvbox.androidCompleto(),
    });
  }
  linhas.push({ titulo: 'Mais', app: true, itens: mais });
  aplicarLinhas(linhas);
  desenhar({ sistemas: [] }, false);
  if (!tv.navegador) avisar('Microsoft Edge ou Google Chrome não encontrado: instale um deles para usar os apps de TV.');
}

async function abrirTela(tela) {
  if (tela === estado.tela) return;
  if (tela === 'tv') estado.posInicio = { l: estado.l, c: estado.c.slice() };
  estado.tela = tela;
  const volta = tela === 'inicio' && estado.posInicio;
  estado.l = volta ? estado.posInicio.l : 0;
  estado.c = volta ? estado.posInicio.c : [];
  document.body.dataset.tela = tela;
  desenharRodape();
  await carregar();
}

function desenhar(dados, semJogos) {
  const main = el('linhas');
  main.textContent = '';
  estado.linhas.forEach((linha, li) => {
    const sec = document.createElement('section');
    sec.className = 'linha';
    const h = document.createElement('h2');
    h.textContent = linha.titulo;
    const trilho = document.createElement('div');
    trilho.className = 'trilho';
    linha.itens.forEach((it, ci) => {
      const b = document.createElement('button');
      b.className = 'cartao' + (linha.app ? ' app' : '') + (it.capa ? '' : ' sem-capa') + (it.indisponivel ? ' indisponivel' : '');
      b.tabIndex = -1;
      if (linha.app && it.cor) b.style.background = `linear-gradient(135deg, ${it.cor}, #161b2e 85%)`;
      if (it.capa) {
        const img = document.createElement('img');
        img.src = it.capa;
        img.alt = '';
        b.appendChild(img);
      } else if (it.icone) {
        const i = document.createElement('span');
        i.className = 'icone';
        i.textContent = it.icone;
        b.appendChild(i);
      }
      const n = document.createElement('span');
      n.className = 'nome';
      n.textContent = it.nome;
      b.appendChild(n);
      b.addEventListener('click', () => { estado.l = li; estado.c[li] = ci; focar(); comando('ok'); });
      trilho.appendChild(b);
    });
    sec.append(h, trilho);
    main.appendChild(sec);

    if (li === 0 && semJogos) {
      const p = document.createElement('p');
      p.className = 'vazio';
      p.textContent = 'Nenhum jogo encontrado. Coloque os jogos nas pastas de cada sistema (ex.: '
        + (dados.sistemas[0] ? dados.sistemas[0].pasta : 'Jogos\\ps2') + ') e escolha "Atualizar lista".';
      main.appendChild(p);
    }
  });
  focar();
}

function cartao(l, c) {
  const sec = el('linhas').querySelectorAll('section.linha')[l];
  return sec ? sec.querySelectorAll('.cartao')[c] : null;
}

function focar() {
  document.querySelectorAll('.cartao.foco').forEach((x) => x.classList.remove('foco'));
  document.querySelectorAll('.linha.ativa').forEach((x) => x.classList.remove('ativa'));
  const b = cartao(estado.l, estado.c[estado.l]);
  if (!b) return;
  b.classList.add('foco');
  b.closest('.linha').classList.add('ativa');
  b.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
}

// ---------- ações ----------
function mover(dl, dc) {
  if (dl) estado.l = Math.max(0, Math.min(estado.linhas.length - 1, estado.l + dl));
  if (dc) {
    const total = estado.linhas[estado.l].itens.length;
    estado.c[estado.l] = Math.max(0, Math.min(total - 1, estado.c[estado.l] + dc));
  }
  focar();
}

async function ativar() {
  if (estado.ocupado) return;
  const item = estado.linhas[estado.l] && estado.linhas[estado.l].itens[estado.c[estado.l]];
  if (!item) return;
  estado.ocupado = true;
  try {
    const r = await item.acao();
    if (r && r.ok === false) avisar(r.erro);
    else if (r && r.msg) avisar(r.msg, true);
  } catch (e) {
    avisar(String(e.message || e));
  } finally {
    estado.ocupado = false;
  }
}

function voltar() {
  if (estado.tela !== 'inicio') return abrirTela('inicio');
  estado.l = 0;
  focar();
}

async function irParaSistema() {
  if (estado.tela !== 'inicio') await abrirTela('inicio');
  const i = estado.linhas.findIndex((x) => x.sistema);
  estado.l = i >= 0 ? i : estado.linhas.length - 1;
  focar();
}

/** Ponto único de entrada: teclado, controle e mouse chamam daqui. */
function comando(nome) {
  if (estado.pausado) return;
  if (estado.captura) {
    if (nome === 'voltar') return fecharCaptura('Configuração do controle cancelada.');
    return;
  }
  if (estado.modal) {
    if (nome === 'esq' || nome === 'dir') { estado.modal.escolha = nome === 'esq' ? 0 : 1; pintarModal(); }
    else if (nome === 'ok') fecharModal(estado.modal.escolha === 0);
    else if (nome === 'voltar') fecharModal(false);
    return;
  }
  if (estado.ajuda) {
    if (['ok', 'voltar', 'ajuda'].includes(nome)) fecharAjuda();
    return;
  }
  const total = () => estado.linhas[estado.l].itens.length;
  const acoes = {
    cima: () => mover(-1, 0), baixo: () => mover(1, 0), esq: () => mover(0, -1), dir: () => mover(0, 1),
    ok: ativar, voltar, ajuda: abrirAjuda, sistema: irParaSistema, controle: abrirCaptura,
    atualizar: () => carregar().then(() => avisar('Lista atualizada.', true)),
    pagAnt: () => mover(0, -5), pagProx: () => mover(0, 5),
    inicioLinha: () => mover(0, -total()), fimLinha: () => mover(0, total()),
    linhaAnt: () => mover(-1, 0), linhaProx: () => mover(1, 0),
  };
  if (acoes[nome]) acoes[nome]();
}

// ---------- teclado ----------
const TECLAS = {
  ArrowUp: 'cima', ArrowDown: 'baixo', ArrowLeft: 'esq', ArrowRight: 'dir',
  w: 'cima', s: 'baixo', a: 'esq', d: 'dir',
  Enter: 'ok', ' ': 'ok', Escape: 'voltar', Backspace: 'voltar', BrowserBack: 'voltar',
  F1: 'ajuda', h: 'ajuda', '?': 'ajuda', F5: 'atualizar', r: 'atualizar',
  m: 'sistema', F10: 'sistema', ContextMenu: 'sistema', F2: 'controle',
  PageUp: 'pagAnt', PageDown: 'pagProx', Home: 'inicioLinha', End: 'fimLinha',
};
document.addEventListener('keydown', (e) => {
  if (estado.pausado || e.ctrlKey || e.altKey || e.metaKey) return;
  if (estado.captura) {
    e.preventDefault();
    if (e.key === 'Escape') fecharCaptura('Configuração do controle cancelada.');
    else if (e.key === ' ' || e.key === 'Enter') pularPasso();
    return;
  }
  const nome = e.key === 'Tab' ? (e.shiftKey ? 'linhaAnt' : 'linhaProx') : TECLAS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (nome) { e.preventDefault(); comando(nome); }
});

// ---------- mouse: aparece ao mexer, some sozinho; rodinha troca de linha ----------
let timerCursor;
document.addEventListener('mousemove', () => {
  document.body.classList.add('com-mouse');
  clearTimeout(timerCursor);
  timerCursor = setTimeout(() => document.body.classList.remove('com-mouse'), 3000);
});
let rodaEm = 0;
document.addEventListener('wheel', (e) => {
  const agora = Date.now();
  if (agora - rodaEm < 150 || estado.ajuda) return;
  rodaEm = agora;
  comando(e.deltaY > 0 ? 'baixo' : 'cima');
}, { passive: true });

// ---------- controle: qualquer modelo, pelo mapeamento de lib/controles.js ----------
const BOTOES = { A: 'ok', B: 'voltar', X: 'ajuda', SELECT: 'ajuda', Y: 'atualizar', START: 'sistema',
  LB: 'pagAnt', RB: 'pagProx', LT: 'inicioLinha', RT: 'fimLinha' };
const DIRECOES = ['cima', 'baixo', 'esq', 'dir'];
const repeticao = {}; // direção -> { desde, ultimo }
const anterior = {};

function pads() {
  return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
}

function lerControles(t) {
  // Não depende do foco da janela: ao voltar de um jogo, o Windows às vezes não devolve o foco,
  // mas o controle continua funcionando. Enquanto um app está aberto (pausado), ignora o controle.
  if (estado.captura) passoCaptura(t);
  else if (!estado.pausado) {
    const agora = {};
    for (const gp of pads()) {
      const a = C.lerAcoes(gp, estado.controles);
      for (const k in a) agora[k] = agora[k] || a[k];
    }
    for (const k of DIRECOES) {
      if (!agora[k]) { delete repeticao[k]; continue; }
      const r = repeticao[k];
      if (!r) { repeticao[k] = { desde: t, ultimo: t }; comando(k); }
      else if (t - r.desde > 400 && t - r.ultimo > 110) { r.ultimo = t; comando(k); }
    }
    // Select + Start juntos não abrem nada aqui (é o atalho de sair dentro dos apps).
    const combo = agora.SELECT && agora.START;
    for (const [botao, cmd] of Object.entries(BOTOES)) {
      if (agora[botao] && !anterior[botao] && !combo) comando(cmd);
    }
    Object.assign(anterior, agora);
  }
  requestAnimationFrame(lerControles);
}

window.addEventListener('gamepadconnected', (e) => {
  const m = C.mapaDe(e.gamepad, estado.controles);
  const nome = e.gamepad.id.replace(/\s*\(.*\)\s*$/, '') || 'controle';
  const dica = m.origem === 'standard' || m.origem === 'usuario'
    ? '' : ' — se algum botão não responder certo, use Sistema → Configurar controle (F2).';
  avisar(`Controle conectado: ${nome}${dica}`, !dica);
});
window.addEventListener('gamepaddisconnected', (e) => avisar(`Controle desconectado: ${e.gamepad.id.replace(/\s*\(.*\)\s*$/, '')}`));

// ---------- configurar controle (aperte cada botão) ----------
const ESPERA_PASSO = 8000;

function abrirCaptura() {
  estado.captura = { fase: 'escolher', bases: {}, gp: null, passo: 0, acoes: {}, ate: 0, proxima: null };
  el('captura').hidden = false;
  pintarCaptura('Aperte qualquer botão no controle que você quer configurar.', 'Esc = cancelar');
}

function fecharCaptura(msg, ok = false) {
  estado.captura = null;
  el('captura').hidden = true;
  Object.assign(anterior, { A: true, B: true, X: true, Y: true, SELECT: true, START: true });
  if (msg) avisar(msg, ok);
}

function pintarCaptura(texto, rodape, progresso) {
  el('captura-texto').textContent = texto;
  el('captura-rodape').textContent = rodape || '';
  el('captura-progresso').textContent = progresso || '';
}

function baseLimpa(gp) {
  // Botões contam como soltos (quem abriu esta tela pode estar segurando o A); eixos, como estão agora.
  const f = C.foto(gp);
  f.botoes = f.botoes.map(() => false);
  return f;
}

function pularPasso() {
  const cap = estado.captura;
  if (!cap || cap.fase !== 'passo') return;
  cap.passo++;
  iniciarPasso();
}

function iniciarPasso() {
  const cap = estado.captura;
  if (cap.passo >= C.ACOES.length) return concluirCaptura();
  cap.fase = 'passo';
  cap.ate = performance.now() + ESPERA_PASSO;
  const acao = C.ACOES[cap.passo];
  pintarCaptura(`Aperte: ${C.NOMES[acao]}`, 'Sem esse botão? Espere 8 s ou aperte Espaço (mantém o atual). Esc = cancelar',
    `${cap.passo + 1} de ${C.ACOES.length}`);
}

async function concluirCaptura() {
  const cap = estado.captura;
  const gp = pads().find((p) => p.index === cap.gp);
  const id = gp ? gp.id : cap.id;
  const atual = C.mapaDe({ id, mapping: cap.mapping }, estado.controles).acoes;
  const acoes = {};
  for (const a of C.ACOES) acoes[a] = cap.acoes[a] || atual[a] || null;
  if (!acoes.A || !acoes.B) return fecharCaptura('Faltou o botão A ou B: nada foi salvo. Tente de novo.');
  fecharCaptura();
  const r = await salvarControle(C.chave(id), { nome: id, acoes });
  if (r && r.ok) avisar('Controle configurado. Vale aqui e dentro dos apps de TV.', true);
}

async function salvarControle(k, mapa) {
  const r = await window.tvbox.salvarControle(k, mapa);
  if (r && r.ok) estado.controles = r.controles || {};
  else if (r) avisar(r.erro || 'Não consegui salvar o controle.');
  if (r && r.ok && !mapa) return { ok: true, msg: 'Controles de volta ao padrão.' };
  return r;
}

function passoCaptura(t) {
  const cap = estado.captura;
  const lista = pads();
  if (cap.fase === 'escolher') {
    for (const gp of lista) {
      if (!cap.bases[gp.index]) cap.bases[gp.index] = baseLimpa(gp);
      if (C.detectar(cap.bases[gp.index], gp)) {
        cap.gp = gp.index;
        cap.id = gp.id;
        cap.mapping = gp.mapping;
        cap.base = cap.bases[gp.index];
        cap.fase = 'soltar';
        cap.proxima = iniciarPasso;
        pintarCaptura(`Controle: ${gp.id.replace(/\s*\(.*\)\s*$/, '')}`, 'Solte os botões...');
        return;
      }
    }
    return;
  }
  const gp = lista.find((p) => p.index === cap.gp);
  if (!gp) return fecharCaptura('O controle foi desconectado. Configuração cancelada.');
  if (cap.fase === 'soltar') {
    if (C.emRepouso(cap.base, gp)) { cap.fase = ''; cap.proxima(); }
    return;
  }
  if (cap.fase === 'passo') {
    const e = C.detectar(cap.base, gp);
    if (e) {
      cap.acoes[C.ACOES[cap.passo]] = e;
      pintarCaptura(`${C.NOMES[C.ACOES[cap.passo]]} = ${C.descrever(e)}`, 'Solte...', `${cap.passo + 1} de ${C.ACOES.length}`);
      cap.passo++;
      cap.fase = 'soltar';
      cap.proxima = iniciarPasso;
    } else if (t > cap.ate) {
      cap.passo++;
      iniciarPasso();
    }
  }
}

// ---------- barra lateral (usuário, relógio, data, versão) ----------
function iniciais(nome) {
  const p = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '🙂';
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

function pintarLateral(dados) {
  const usuario = dados.usuario || 'Jogador';
  el('usuario').textContent = usuario;
  el('avatar').textContent = iniciais(usuario);
  el('versao').textContent = `${dados.titulo} · versão ${dados.versao || '?'}`;
  el('desenvolvedor').textContent = dados.desenvolvedor || 'renildo.junior';
  const n = dados.totalJogos || 0;
  el('lateral-jogos').textContent = `🕹️ ${n} ${n === 1 ? 'jogo' : 'jogos'} na biblioteca`;
}

function pintarControles() {
  const lista = pads();
  const alvo = el('lateral-controle');
  if (!lista.length) {
    alvo.textContent = '🎮 Nenhum controle';
    alvo.classList.remove('ligado');
    return;
  }
  const nome = lista[0].id.replace(/\s*\(.*\)\s*$/, '') || 'controle';
  alvo.textContent = lista.length > 1 ? `🎮 ${lista.length} controles conectados` : `🎮 ${nome}`;
  alvo.classList.add('ligado');
}
window.addEventListener('gamepadconnected', pintarControles);
window.addEventListener('gamepaddisconnected', pintarControles);

function relogio() {
  const agora = new Date();
  el('relogio').textContent = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const data = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  el('data').textContent = data.charAt(0).toUpperCase() + data.slice(1);
}

// Ao voltar de um emulador, ignora o botão que ainda estiver apertado (evita reabrir o jogo).
window.tvbox.aoVoltar(() => {
  estado.pausado = false;
  for (const k of C.ACOES) anterior[k] = true;
  for (const k in repeticao) delete repeticao[k];
  focar();
});
window.tvbox.aoSair(() => { estado.pausado = true; });

relogio();
setInterval(relogio, 5000);
pintarControles();
document.body.dataset.tela = 'inicio';
desenharRodape();
carregar();
requestAnimationFrame(lerControles);

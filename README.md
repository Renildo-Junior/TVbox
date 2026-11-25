# TV Box

Launcher em tela cheia, controlado por **controle de videogame** (ou teclado), para transformar um PC
antigo em central de TV e jogos:

- **Android TV**: tela de TV com YouTube (interface de TV), Netflix, Spotify, Prime Video, Disney+, HBO Max,
  Globoplay, Twitch e Pluto TV em tela cheia, usados pelo controle ([docs/ANDROID-TV.md](docs/ANDROID-TV.md)).
  Dual boot com Android de verdade é opcional.
- **Sair de qualquer jogo ou app**: segure **Select + Start** por 1,5 s e o TV Box volta.
- **Jogos**: biblioteca montada sozinha a partir das pastas de jogos, abrindo o emulador certo em tela cheia.
  Ao fechar o emulador, a tela do TV Box volta sozinha.

| Sistema | Emulador |
|---|---|
| PlayStation 2 | PCSX2 |
| PlayStation 1 | DuckStation |
| PSP | PPSSPP |
| GameCube / Wii | Dolphin |
| N64, SNES, NES, Mega Drive/Master System, GB/GBC/GBA, Arcade | RetroArch (cores mupen64plus_next, snes9x, fceumm, genesis_plus_gx, mgba, fbneo) |

## Requisitos da máquina

- Windows 10 ou 11 **64 bits** (o Electron atual não roda no Windows 7/8).
- PS2: processador com **SSE4.1** (obrigatório no PCSX2 2.x), de preferência com AVX2, 4 núcleos e
  placa de vídeo com DirectX 11/Vulkan. Em processador fraco, até PS1/N64/PSP roda bem e o PS2 fica lento.
- 4 GB de RAM (8 GB recomendado).

## Desenvolvimento

```bash
npm install
npm test          # testes da varredura de jogos e da configuração
npm start         # abre o launcher (F11 alterna tela cheia)
npm run dist      # gera dist/TVBox-<versão>-portatil.exe e dist/TVBox-<versão>-instalador.exe
```

Estrutura:

```
main.js              processo principal: janela, abrir emulador/app, energia
preload.js           ponte segura para a tela (contextIsolation, sandbox)
lib/biblioteca.js    varredura de pastas, nome limpo, montagem de argumentos (sem Electron, testável)
lib/controles.js     leitura de qualquer controle, mapeamento e configuração (usado pela tela e pelos testes)
renderer/            tela (HTML/CSS/JS) com navegação por controle (Gamepad API) e teclado
config.padrao.json   configuração inicial (copiada para o config.json do usuário no 1º uso)
scripts/             instalar-emuladores.ps1, configurar-android.ps1
docs/                ANDROID-TV.md
```

## Montando a máquina

1. Instale o TV Box (`TVBox-x.y.z-instalador.exe`) na máquina.
2. PowerShell como administrador, na pasta `resources\scripts` do TV Box:
   `powershell -ExecutionPolicy Bypass -File .\instalar-emuladores.ps1`
   (instala os emuladores, baixa os cores do RetroArch e cria `%USERPROFILE%\Jogos\<sistema>`).
3. **BIOS**: copie para `%USERPROFILE%\Jogos\bios\ps1`, `ps2` e `arcade` (dump do seu próprio console;
   o TV Box não baixa BIOS). Ao abrir, o TV Box copia cada uma para a pasta que o DuckStation, o PCSX2 e o
   RetroArch usam. Sem BIOS de PS1, os jogos de PS1 abrem no RetroArch (core PCSX ReARMed), que roda sem ela.
   A maioria dos jogos de arcade não precisa de BIOS; Neo-Geo precisa do `neogeo.zip`.
4. **Controle nos emuladores**: o RetroArch reconhece sozinho. No PCSX2 e no DuckStation, uma vez:
   Configurações > Controles > Porta 1 > *Mapeamento automático*.
5. Coloque os jogos nas pastas. Capa é opcional: imagem com o mesmo nome do jogo (`.png/.jpg/.webp`)
   ao lado dele ou na subpasta `capas`.
6. Android TV: abra o cartão e faça login em cada serviço uma vez. Detalhes em [docs/ANDROID-TV.md](docs/ANDROID-TV.md).
7. Para ligar direto no TV Box: crie um usuário local com login automático (`netplwiz`) e coloque
   `"iniciarComWindows": true` no config.json.

## Configuração (`config.json`)

Fica em `%APPDATA%\TV Box\config.json` (ou ao lado do `.exe` portátil, se existir lá). Abra pela opção
**Sistema → Configuração** e use **Atualizar lista** depois de salvar.

- `emuladores`: para cada emulador, lista de caminhos possíveis do `.exe` (vale o primeiro que existir; aceita `%VAR%`).
- `apps`: cartões da linha "Início". `tipo: "programa"` abre um emulador/exe; `tipo: "tela"` abre outra tela
  (`"tela": "tv"` = Android TV); `tipo: "comando"` roda um comando; `confirmar` pede confirmação antes.
- `navegador`: caminhos possíveis do Edge/Chrome. `tv.apps`: os apps de TV (`url` https, `userAgent` opcional,
  `"controle": "nativo"` para desligar a simulação de teclado naquele app).
- `bios`: pasta central de cada BIOS e para onde copiar (`{documentos}`, `{emu:retroarch}` = pasta do emulador).
- `sairSegurandoMs`: quanto tempo segurar Select+Start para sair (padrão 1500).
- `sistemas`: pasta, extensões e argumentos. Marcadores: `{rom}` = arquivo do jogo, `{dir}` = pasta do emulador.
  `profundidade` = quantos níveis de subpasta varrer (padrão 2).

## Controles

Tudo no TV Box funciona por **controle, teclado ou mouse** (os três chamam os mesmos comandos). A lista
completa aparece na tela com **X / Select** no controle ou **F1** no teclado.

| Controle | Teclado | Ação |
|---|---|---|
| D-pad / analógico esquerdo | setas ou W A S D | navegar |
| A (Xbox) / ✕ (PS) | Enter ou Espaço | abrir / confirmar |
| B / ◯ | Esc ou Backspace | voltar (sai da tela de TV) / cancelar |
| X / ▢ ou Select | F1 ou H | ajuda (lista de comandos) |
| Y / △ | F5 ou R | atualizar lista de jogos |
| Start | M, F10 ou tecla Menu | menu Sistema |
| LB / RB (L1 / R1) | Page Up / Page Down | pular 5 cartões |
| LT / RT (L2 / R2) | Home / End | início / fim da linha |
| — | Tab / Shift+Tab | próxima / anterior linha |
| Sistema → Configurar controle | F2 | mapear os botões de um controle |
| — | F11 | tela cheia liga/desliga |
| **Segurar Select + Start** | **Ctrl + Alt + Backspace** | dentro de jogo ou app: fecha e volta ao TV Box |

Mouse: clique abre o cartão; a rodinha troca de linha; o cursor aparece ao mexer e some depois de 3 s.

### Qualquer controle

- **Xbox, PS4/PS5 e compatíveis** são reconhecidos sozinhos (layout padrão).
- **Genérico USB/Bluetooth**: o TV Box usa o layout mais comum para o fabricante. Se algum botão vier
  trocado, abra **Sistema → Configurar controle** (ou F2), aperte qualquer botão do controle e depois
  cada botão que a tela pedir (16 passos; Espaço ou 8 s sem apertar pula e mantém o atual).
  O mapeamento é salvo por modelo (`vid:pid`) em `controles` no config.json e vale no TV Box **e** dentro
  dos apps de TV. **Sistema → Controles: voltar ao padrão** apaga os mapeamentos.
- **Vários controles ao mesmo tempo** funcionam: qualquer um navega.
- Dentro dos jogos quem lê o controle é o emulador (RetroArch reconhece sozinho; PCSX2/DuckStation:
  *Mapeamento automático* uma vez). A ponte (`scripts/controle-ponte.ps1`) lê XInput e, pelo WinMM, todos os
  demais controles, e cuida do Select+Start para sair e do controle-como-teclado nos apps de TV.
- `atalhoFechar` no config.json muda a tecla global de fechar (formato do Electron, ex.: `"Control+Alt+Q"`).

# Android TV no TV Box

O cartão **Android TV** abre a tela de TV do TV Box, com os apps de streaming em tela cheia,
controlados pelo controle de videogame:

YouTube (interface de TV) · Netflix · Spotify · Prime Video · Disney+ · HBO Max · Globoplay · Twitch · Pluto TV · Navegador

## Como funciona

- Cada app abre no **Microsoft Edge** (ou Google Chrome, se não houver Edge) em modo aplicativo e tela
  cheia, sem barra de endereço. O Edge é usado porque tem a proteção de vídeo (DRM) que a Netflix, o Prime
  e o Disney+ exigem. No Edge a Netflix chega a 1080p; no Chrome, a 720p.
- Faça o login em cada serviço **uma vez**: o TV Box guarda o perfil em `%LOCALAPPDATA%\TVBox\navegador`.
- O YouTube abre em `youtube.com/tv`, a interface de TV. O TV Box se identifica como um console Xbox
  (campo `userAgent` no config.json) para o YouTube mostrar essa tela em vez da versão de computador.

### Controle dentro dos apps

Enquanto um app de TV está aberto, a **ponte do controle** (`scripts/controle-ponte.ps1`) transforma o
controle em teclado e mouse:

| Controle | Faz |
|---|---|
| D-pad | setas (navegar) |
| A | Enter (abrir / confirmar) |
| B | Esc (voltar / sair da tela cheia) |
| Y | Espaço (play / pause) |
| Select (apertar e soltar) | voltar página |
| RB / LB | próximo / anterior item (Tab / Shift+Tab) |
| Analógico esquerdo + X | mover o mouse + clicar |
| Analógico direito | rolar a página |
| LT / RT | volume − / + |
| L3 (apertar o analógico esquerdo) | tecla F (tela cheia do vídeo no YouTube/Netflix) |
| R3 (apertar o analógico direito) | abre/fecha o teclado na tela do Windows (para digitar busca, login) |
| **Segurar Select + Start (1,5 s)** | **fecha o app e volta ao TV Box** |

No teclado físico, tudo funciona normalmente dentro do app; **Ctrl + Alt + Backspace** fecha o app e volta
ao TV Box (o atalho muda no config.json, campo `atalhoFechar`).

O YouTube TV é todo navegável pelo D-pad. Netflix, Spotify e os outros sites foram feitos para mouse:
use o D-pad e o RB/LB onde funcionar e o analógico + X para o resto.

Se algum app passar a andar "dois passos" por toque (porque ele também lê o controle sozinho), coloque
`"controle": "nativo"` nesse app no config.json: a ponte deixa de simular o teclado e só cuida do Select+Start.

A ponte lê **qualquer controle**: XInput (Xbox 360/One/Series e compatíveis) e, pelo WinMM, PS4/PS5,
Switch Pro e genéricos USB, sem precisar de DS4Windows. Controle genérico com botões trocados: no TV Box,
**Sistema → Configurar controle** (ou F2); o mapeamento salvo vale também aqui dentro dos apps.

### Adicionar ou tirar apps

No config.json, em `tv.apps`:

```json
{ "id": "crunchyroll", "nome": "Crunchyroll", "icone": "🍥", "cor": "#f47521", "url": "https://www.crunchyroll.com" }
```

Só endereços `https://` são aceitos.

## Por que não o Android de verdade?

O Android para PC (Bliss OS / Android-x86) não é certificado pelo Google, então a **Netflix não instala ou roda em baixa qualidade**, o Prime e o Disney+ costumam falhar,
e o Android TV oficial (Google TV) não existe para PC. Pelo Edge, os mesmos serviços funcionam em alta
qualidade, sem dual boot e sem sair do TV Box.

## Opcional: Android completo em dual boot

Se mesmo assim quiser o Android instalado ao lado do Windows (para apps que só existem no Android):

1. Instale o **Bliss OS** (blissos.org) ou o **Android-x86 9.0** (android-x86.org) numa partição livre de 16 a 32 GB.
2. No Windows, PowerShell **como administrador**, na pasta `scripts` do TV Box
   (instalado: `C:\Program Files\TV Box\resources\scripts`):

```powershell
# lista as entradas de boot — ache a do Android (Bliss OS, Android-x86, GRUB...)
powershell -ExecutionPolicy Bypass -File .\configurar-android.ps1
# entrada UEFI (GRUB do Bliss/Android): use -Firmware
powershell -ExecutionPolicy Bypass -File .\configurar-android.ps1 -Guid '{GUID-AQUI}' -Firmware
```

Depois disso aparece, na tela Android TV, o cartão **Android completo (reiniciar)**: ele reinicia o PC no
Android só uma vez; ao reiniciar o Android, o PC volta ao Windows e ao TV Box. Deixe o *Windows Boot
Manager* como primeiro na ordem de boot da BIOS/UEFI.

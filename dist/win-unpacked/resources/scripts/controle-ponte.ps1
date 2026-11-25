<#
.SYNOPSIS
  Ponte do controle enquanto um app/emulador está aberto pelo TV Box.
.DESCRIPTION
  Iniciado pelo próprio TV Box, sem janela. Fica lendo os controles até o programa -AlvoPid fechar.
  Lê QUALQUER controle: XInput (Xbox e compatíveis) e, pelo WinMM, os demais (PS4/PS5, Switch, genéricos USB).
  O mapeamento de cada modelo vem de -Mapas (gerado pela tela "Configurar controle"); sem ele, usa o
  layout padrão do fabricante (Sony, Microsoft ou genérico).
  - Sempre: segurar SELECT + START por -SegurarMs fecha o programa e volta ao TV Box (sai com código 10).
  - Com -Teclado (apps de TV no navegador): transforma o controle em teclado e mouse:
      D-pad = setas  | A = Enter | B = Esc | Y = Espaço (play/pause) | Select (sozinho) = voltar página
      RB = Tab | LB = Shift+Tab | X = clique | analógico esquerdo = mouse | analógico direito = rolar
      LT/RT = volume -/+ | L3 = tecla F (tela cheia do vídeo) | R3 = teclado na tela (abre/fecha)
#>
param(
  [Parameter(Mandatory)][int]$AlvoPid,
  [switch]$Teclado,
  [int]$SegurarMs = 1500,
  [string]$Mapas = ''
)
$ErrorActionPreference = 'Stop'

$codigo = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace TVBox
{
    public static class Ponte
    {
        // ---------- XInput ----------
        [StructLayout(LayoutKind.Sequential)]
        public struct XGamepad { public ushort Botoes; public byte LT; public byte RT; public short LX; public short LY; public short RX; public short RY; }

        [StructLayout(LayoutKind.Sequential)]
        public struct XEstado { public uint Pacote; public XGamepad Pad; }

        [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")]
        static extern uint Get14(uint indice, out XEstado estado);

        [DllImport("xinput9_1_0.dll", EntryPoint = "XInputGetState")]
        static extern uint Get91(uint indice, out XEstado estado);

        // ---------- WinMM (qualquer joystick/controle HID) ----------
        [StructLayout(LayoutKind.Sequential)]
        public struct JoyInfoEx
        {
            public uint dwSize, dwFlags, dwXpos, dwYpos, dwZpos, dwRpos, dwUpos, dwVpos, dwButtons, dwButtonNumber, dwPOV, dwReserved1, dwReserved2;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct JoyCaps
        {
            public ushort wMid, wPid;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
            public uint wXmin, wXmax, wYmin, wYmax, wZmin, wZmax, wNumButtons, wPeriodMin, wPeriodMax,
                        wRmin, wRmax, wUmin, wUmax, wVmin, wVmax, wCaps, wMaxAxes, wNumAxes, wMaxButtons;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szRegKey;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szOEMVxD;
        }

        [DllImport("winmm.dll")]
        static extern uint joyGetPosEx(uint id, ref JoyInfoEx info);

        [DllImport("winmm.dll", CharSet = CharSet.Unicode, EntryPoint = "joyGetDevCapsW")]
        static extern uint joyGetDevCaps(UIntPtr id, ref JoyCaps caps, uint tamanho);

        // ---------- Raw Input (descobrir quais controles já são XInput, para não ler duas vezes) ----------
        [StructLayout(LayoutKind.Sequential)]
        struct RawLista { public IntPtr hDevice; public uint dwType; }

        [DllImport("user32.dll")]
        static extern uint GetRawInputDeviceList([Out] RawLista[] lista, ref uint qtd, uint tamanho);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetRawInputDeviceInfoW")]
        static extern uint GetRawInputDeviceInfo(IntPtr h, uint cmd, StringBuilder dados, ref uint tamanho);

        // ---------- saída: teclado e mouse ----------
        [DllImport("user32.dll")]
        static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

        [DllImport("user32.dll")]
        static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);

        // Bits no formato XInput (a lógica toda trabalha com eles, venha o controle de onde vier).
        const int CIMA = 0x0001, BAIXO = 0x0002, ESQ = 0x0004, DIR = 0x0008, START = 0x0010, BACK = 0x0020,
                  L3 = 0x0040, R3 = 0x0080, LB = 0x0100, RB = 0x0200, A = 0x1000, B = 0x2000, X = 0x4000, Y = 0x8000;

        // Ordem do mapeamento (igual a lib/controles.js -> textoPonte).
        static readonly string[] NOMES = { "A", "B", "X", "Y", "LB", "RB", "LT", "RT", "SELECT", "START", "L3", "R3", "CIMA", "BAIXO", "ESQ", "DIR" };
        static readonly int[] BITS = { A, B, X, Y, LB, RB, 0, 0, BACK, START, L3, R3, CIMA, BAIXO, ESQ, DIR };
        const int SEM = -1, POV = -2, XMENOS = -3, XMAIS = -4, YMENOS = -5, YMAIS = -6;

        static readonly int[] SONY =    { 1, 2, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, POV, POV, POV, POV };
        static readonly int[] XBOX =    { 0, 1, 2, 3, 4, 5, SEM, SEM, 6, 7, 8, 9, POV, POV, POV, POV };
        static readonly int[] GENERICO = { 2, 1, 3, 0, 4, 5, 6, 7, 8, 9, 10, 11, POV, POV, POV, POV };
        static readonly int[] GENERICO_SEM_POV = { 2, 1, 3, 0, 4, 5, 6, 7, 8, 9, 10, 11, YMENOS, YMAIS, XMENOS, XMAIS };

        static Dictionary<string, int[]> mapas = new Dictionary<string, int[]>();
        static HashSet<string> xinputHid = new HashSet<string>();

        class Joy { public bool ligado; public long tentarEm; public JoyCaps caps; public int[] mapa; public bool ignorar; }
        static Joy[] joys = new Joy[16];

        static bool usar91 = false;

        static bool LerX(uint i, out XEstado s)
        {
            if (!usar91)
            {
                try { return Get14(i, out s) == 0; }
                catch (DllNotFoundException) { usar91 = true; }
                catch (EntryPointNotFoundException) { usar91 = true; }
            }
            try { return Get91(i, out s) == 0; }
            catch { s = new XEstado(); return false; }
        }

        static void CarregarMapas(string arquivo)
        {
            if (string.IsNullOrEmpty(arquivo) || !File.Exists(arquivo)) return;
            foreach (string bruta in File.ReadAllLines(arquivo))
            {
                string linha = bruta.Trim();
                if (linha.Length == 0 || linha.StartsWith("#")) continue;
                string[] partes = linha.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (partes.Length < 2 || !Regex.IsMatch(partes[0], "^[0-9a-f]{4}:[0-9a-f]{4}$")) continue;
                int[] m = new int[NOMES.Length];
                for (int k = 0; k < m.Length; k++) m[k] = SEM;
                for (int p = 1; p < partes.Length; p++)
                {
                    string[] kv = partes[p].Split('=');
                    if (kv.Length != 2) continue;
                    int k = Array.IndexOf(NOMES, kv[0]);
                    if (k < 0) continue;
                    int n;
                    if (kv[1] == "pov") m[k] = POV;
                    else if (kv[1] == "x-") m[k] = XMENOS;
                    else if (kv[1] == "x+") m[k] = XMAIS;
                    else if (kv[1] == "y-") m[k] = YMENOS;
                    else if (kv[1] == "y+") m[k] = YMAIS;
                    else if (int.TryParse(kv[1], out n) && n >= 0 && n < 32) m[k] = n;
                }
                mapas[partes[0]] = m;
            }
        }

        static void AtualizarXInputHid()
        {
            HashSet<string> novo = new HashSet<string>();
            try
            {
                uint qtd = 0, tam = (uint)Marshal.SizeOf(typeof(RawLista));
                GetRawInputDeviceList(null, ref qtd, tam);
                if (qtd > 0)
                {
                    RawLista[] lista = new RawLista[qtd];
                    uint lidos = GetRawInputDeviceList(lista, ref qtd, tam);
                    for (int i = 0; i < lidos && i < lista.Length; i++)
                    {
                        if (lista[i].dwType != 2) continue; // 2 = HID (controles)
                        uint chars = 0;
                        GetRawInputDeviceInfo(lista[i].hDevice, 0x20000007, null, ref chars);
                        if (chars == 0) continue;
                        StringBuilder sb = new StringBuilder((int)chars + 1);
                        if (GetRawInputDeviceInfo(lista[i].hDevice, 0x20000007, sb, ref chars) == uint.MaxValue) continue;
                        string nome = sb.ToString().ToUpperInvariant();
                        if (nome.IndexOf("IG_", StringComparison.Ordinal) < 0) continue;
                        Match m = Regex.Match(nome, "VID_([0-9A-F]{4})&PID_([0-9A-F]{4})");
                        if (m.Success) novo.Add((m.Groups[1].Value + ":" + m.Groups[2].Value).ToLowerInvariant());
                    }
                }
            }
            catch { }
            xinputHid = novo;
        }

        static int[] MapaPara(string chave, ushort vid, JoyCaps caps)
        {
            int[] m;
            if (mapas.TryGetValue(chave, out m)) return m;
            if (vid == 0x054C) return SONY;
            if (vid == 0x045E) return XBOX;
            return (caps.wCaps & 0x10) != 0 ? GENERICO : GENERICO_SEM_POV; // 0x10 = JOYCAPS_HASPOV
        }

        static int Normalizar(uint v, uint min, uint max)
        {
            if (max <= min) return 0;
            double f = ((double)v - min) / ((double)max - min) * 2.0 - 1.0;
            return (int)(Math.Max(-1.0, Math.Min(1.0, f)) * 32767);
        }

        static bool PovTem(uint pov, int bit)
        {
            if (pov > 35999) return false; // 0xFFFF = parado
            double g = pov / 100.0;
            if (bit == CIMA) return g >= 292.5 || g <= 67.5;
            if (bit == DIR) return g >= 22.5 && g <= 157.5;
            if (bit == BAIXO) return g >= 112.5 && g <= 247.5;
            return g >= 202.5 && g <= 337.5; // ESQ
        }

        /** Lê os controles WinMM e soma no estado (formato XInput). */
        static void LerWinMM(long agora, ref int b, ref int lx, ref int ly, ref int ry, ref int lt, ref int rt)
        {
            for (uint i = 0; i < joys.Length; i++)
            {
                Joy j = joys[i] ?? (joys[i] = new Joy());
                if (!j.ligado && agora < j.tentarEm) continue;
                JoyInfoEx s = new JoyInfoEx();
                s.dwSize = (uint)Marshal.SizeOf(typeof(JoyInfoEx));
                s.dwFlags = 0xFF | 0x200; // JOY_RETURNALL | JOY_RETURNPOVCTS
                if (joyGetPosEx(i, ref s) != 0) { j.ligado = false; j.tentarEm = agora + 2000; continue; }
                if (!j.ligado)
                {
                    j.ligado = true;
                    JoyCaps c = new JoyCaps();
                    joyGetDevCaps((UIntPtr)i, ref c, (uint)Marshal.SizeOf(typeof(JoyCaps)));
                    j.caps = c;
                    string chave = c.wMid.ToString("x4") + ":" + c.wPid.ToString("x4");
                    AtualizarXInputHid();
                    j.ignorar = xinputHid.Contains(chave); // esse já é lido pelo XInput
                    j.mapa = MapaPara(chave, c.wMid, c);
                }
                if (j.ignorar) continue;

                int x = Normalizar(s.dwXpos, j.caps.wXmin, j.caps.wXmax);
                int y = Normalizar(s.dwYpos, j.caps.wYmin, j.caps.wYmax);
                int r = Normalizar(s.dwRpos, j.caps.wRmin, j.caps.wRmax);
                bool dpadEixos = false;
                for (int k = 0; k < NOMES.Length; k++)
                {
                    int v = j.mapa[k];
                    bool on;
                    if (v >= 0) on = (s.dwButtons & (1u << v)) != 0;
                    else if (v == POV) on = BITS[k] != 0 && PovTem(s.dwPOV, BITS[k]);
                    else if (v == XMENOS) { on = x < -16000; dpadEixos = true; }
                    else if (v == XMAIS) { on = x > 16000; dpadEixos = true; }
                    else if (v == YMENOS) { on = y < -16000; dpadEixos = true; }
                    else if (v == YMAIS) { on = y > 16000; dpadEixos = true; }
                    else on = false;
                    if (!on) continue;
                    if (NOMES[k] == "LT") lt = 255;
                    else if (NOMES[k] == "RT") rt = 255;
                    else b |= BITS[k];
                }
                if (!dpadEixos)
                {
                    if (Math.Abs(x) > Math.Abs(lx)) lx = x;
                    if (Math.Abs(y) > Math.Abs(ly)) ly = -y; // WinMM: Y cresce para baixo
                }
                if (Math.Abs(r) > Math.Abs(ry)) ry = -r;
            }
        }

        static void Tecla(byte vk, bool estendida)
        {
            uint f = estendida ? 1u : 0u;
            keybd_event(vk, 0, f, UIntPtr.Zero);
            keybd_event(vk, 0, f | 2u, UIntPtr.Zero);
        }

        static void AlternarTecladoNaTela()
        {
            try
            {
                Process[] abertos = Process.GetProcessesByName("osk");
                if (abertos.Length > 0) { foreach (Process p in abertos) { try { p.CloseMainWindow(); } catch { } } return; }
                string osk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "osk.exe");
                ProcessStartInfo psi = new ProcessStartInfo(File.Exists(osk) ? osk : "osk.exe");
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch { }
        }

        static bool Vivo(int pid)
        {
            Process p;
            try { p = Process.GetProcessById(pid); }
            catch { return false; }
            try { return !p.HasExited; }
            catch { return true; }
        }

        static double Eixo(int v)
        {
            double f = v / 32767.0;
            double a = Math.Abs(f);
            if (a < 0.25) return 0;
            double s = (Math.Min(a, 1.0) - 0.25) / 0.75;
            return Math.Sign(f) * s * s;
        }

        // 10 = usuário segurou Select+Start; 0 = o programa fechou sozinho.
        public static int Rodar(int pid, bool teclado, int segurarMs, string arquivoMapas)
        {
            try { CarregarMapas(arquivoMapas); } catch { }
            AtualizarXInputHid();

            Stopwatch relogio = Stopwatch.StartNew();
            int ant = 0;
            long comboDesde = -1, checarEm = 0, rolarEm = 0, volumeEm = 0;
            bool comboUsado = false;
            bool[] ligado = new bool[4];
            long[] tentarEm = new long[4];
            long[] repetirEm = new long[4];
            int[] direcoes = { CIMA, BAIXO, ESQ, DIR };
            byte[] vkDirecao = { 0x26, 0x28, 0x25, 0x27 };
            double sobraX = 0, sobraY = 0;

            while (true)
            {
                long agora = relogio.ElapsedMilliseconds;
                if (agora >= checarEm)
                {
                    if (!Vivo(pid)) return 0;
                    checarEm = agora + 1000;
                }

                int b = 0, lx = 0, ly = 0, ry = 0, lt = 0, rt = 0;
                for (uint i = 0; i < 4; i++)
                {
                    // Consultar slot vazio é lento no XInput: tenta de novo só a cada 2 s.
                    if (!ligado[i] && agora < tentarEm[i]) continue;
                    XEstado s;
                    if (!LerX(i, out s)) { ligado[i] = false; tentarEm[i] = agora + 2000; continue; }
                    ligado[i] = true;
                    b |= s.Pad.Botoes;
                    if (Math.Abs((int)s.Pad.LX) > Math.Abs(lx)) lx = s.Pad.LX;
                    if (Math.Abs((int)s.Pad.LY) > Math.Abs(ly)) ly = s.Pad.LY;
                    if (Math.Abs((int)s.Pad.RY) > Math.Abs(ry)) ry = s.Pad.RY;
                    lt = Math.Max(lt, (int)s.Pad.LT);
                    rt = Math.Max(rt, (int)s.Pad.RT);
                }
                try { LerWinMM(agora, ref b, ref lx, ref ly, ref ry, ref lt, ref rt); } catch { }

                bool combo = (b & BACK) != 0 && (b & START) != 0;
                if (combo)
                {
                    comboUsado = true;
                    if (comboDesde < 0) comboDesde = agora;
                    else if (agora - comboDesde >= segurarMs) return 10;
                }
                else comboDesde = -1;

                if (teclado)
                {
                    int novo = b & ~ant;
                    int solto = ant & ~b;
                    if ((novo & A) != 0) Tecla(0x0D, false);              // Enter
                    if ((novo & B) != 0) Tecla(0x1B, false);              // Esc
                    if ((novo & Y) != 0) Tecla(0x20, false);              // Espaço
                    if ((novo & RB) != 0) Tecla(0x09, false);             // Tab
                    if ((novo & LB) != 0)                                 // Shift+Tab
                    {
                        keybd_event(0x10, 0, 0, UIntPtr.Zero);
                        Tecla(0x09, false);
                        keybd_event(0x10, 0, 2, UIntPtr.Zero);
                    }
                    if ((novo & L3) != 0) Tecla(0x46, false);             // F (tela cheia do vídeo)
                    if ((novo & R3) != 0) AlternarTecladoNaTela();
                    if ((novo & X) != 0) mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);   // botão esquerdo desce
                    if ((solto & X) != 0) mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);  // e sobe
                    if ((solto & BACK) != 0 && !comboUsado) Tecla(0xA6, false);     // Voltar (navegador)
                    if ((b & (BACK | START)) == 0) comboUsado = false;

                    for (int d = 0; d < 4; d++)
                    {
                        if ((b & direcoes[d]) == 0) { repetirEm[d] = 0; continue; }
                        if (repetirEm[d] == 0) { Tecla(vkDirecao[d], true); repetirEm[d] = agora + 400; }
                        else if (agora >= repetirEm[d]) { Tecla(vkDirecao[d], true); repetirEm[d] = agora + 120; }
                    }

                    double mx = Eixo(lx), my = -Eixo(ly);
                    if (mx != 0 || my != 0)
                    {
                        sobraX += mx * 22; sobraY += my * 22;
                        int dx = (int)sobraX, dy = (int)sobraY;
                        sobraX -= dx; sobraY -= dy;
                        if (dx != 0 || dy != 0) mouse_event(0x0001, dx, dy, 0, UIntPtr.Zero);
                    }
                    double r = Eixo(ry);
                    if (r != 0 && agora >= rolarEm) { mouse_event(0x0800, 0, 0, (int)(r * 120), UIntPtr.Zero); rolarEm = agora + 60; }

                    if (agora >= volumeEm)
                    {
                        if (lt > 128) { Tecla(0xAE, false); volumeEm = agora + 150; }
                        else if (rt > 128) { Tecla(0xAF, false); volumeEm = agora + 150; }
                    }
                }

                ant = b;
                Thread.Sleep(16);
            }
        }
    }
}
'@

try {
  if (-not ('TVBox.Ponte' -as [type])) {
    # Compila uma vez e guarda a DLL (em PC antigo a compilação leva alguns segundos).
    $sha = [Security.Cryptography.SHA1]::Create()
    $hash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($codigo))[0..5] | ForEach-Object { $_.ToString('x2') })
    $pasta = Join-Path $env:LOCALAPPDATA 'TVBox'
    $dll = Join-Path $pasta "ponte-$hash.dll"
    if (-not (Test-Path $dll)) {
      New-Item -ItemType Directory -Force $pasta | Out-Null
      try { Add-Type -TypeDefinition $codigo -OutputAssembly $dll -OutputType Library } catch { Add-Type -TypeDefinition $codigo }
    }
    if (-not ('TVBox.Ponte' -as [type])) { Add-Type -Path $dll }
  }
  exit [TVBox.Ponte]::Rodar($AlvoPid, [bool]$Teclado, $SegurarMs, $Mapas)
} catch {
  [Console]::Error.WriteLine("ponte do controle: $($_.Exception.Message)")
  exit 1
}

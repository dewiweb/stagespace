/// OSC learn — capture le prochain message OSC entrant (bouge le fader
/// une fois) et renvoie son adresse. Le backend expose
/// `get_last_osc_message` = dernier message hors /stagespace/ (addr, args,
/// âge en secondes). Timeout 10s par défaut.
import { safeInvoke as invoke } from './tauri';

type LastMsg = [string, number[], number] | null;

export async function learnOscAddress(timeoutMs = 10_000): Promise<{ address: string; args: number[] } | null> {
  const deadline = Date.now() + timeoutMs;
  // Valeur de base : tout message plus jeune que ce poll compte.
  const since = Date.now();
  while (Date.now() < deadline) {
    const msg = await invoke<LastMsg>('get_last_osc_message').catch(() => null);
    if (msg && Date.now() - msg[2] * 1000 > since - 1500) {
      return { address: msg[0], args: msg[1] };
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return null;
}

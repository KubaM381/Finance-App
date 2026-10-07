// App-Sperre: PIN (PBKDF2-Hash, nie im Klartext gespeichert) und optional Face ID / Touch ID / Fingerabdruck (WebAuthn).
// WICHTIG: Das ist eine Zugriffssperre für die Oberfläche, KEINE Verschlüsselung der Daten in IndexedDB.
// Echter Schutz der gespeicherten Daten (verschlüsselte Datenhaltung/Backups) folgt mit dem Sicherheitskonzept.
const KEY = { pin: "finance-lock-pin", cred: "finance-lock-cred", delay: "finance-lock-delay" };
const ITERATIONS = 150000;
const enc = new TextEncoder();
let overlay = null, hiddenAt = 0, fails = 0, blockedUntil = 0;

const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); return true; } catch { return false; } };
const drop = (key) => { try { localStorage.removeItem(key); } catch { /* optional */ } };
const b64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(pin, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export const isLockEnabled = () => Boolean(read(KEY.pin));
export const hasBiometric = () => Boolean(read(KEY.cred));
export const getLockDelay = () => Number(read(KEY.delay) ?? 1); // Minuten im Hintergrund bis zur Sperre
export const setLockDelay = (minutes) => write(KEY.delay, String(minutes));

export async function setPin(pin) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("Die PIN muss aus 4 bis 8 Ziffern bestehen.");
  if (!globalThis.crypto?.subtle) throw new Error("Dieser Browser unterstützt keine sichere PIN-Speicherung.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ok = write(KEY.pin, JSON.stringify({ salt: b64(salt), iter: ITERATIONS, hash: await derive(pin, salt, ITERATIONS) }));
  if (!ok) throw new Error("Die PIN konnte nicht gespeichert werden.");
}

export async function verifyPin(pin) {
  try {
    const record = JSON.parse(read(KEY.pin));
    return (await derive(pin, unb64(record.salt), record.iter)) === record.hash;
  } catch { return false; }
}

export function removeLock() { drop(KEY.pin); drop(KEY.cred); document.documentElement.classList.remove("locked"); }

export async function biometricAvailable() {
  try { return Boolean(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())); }
  catch { return false; }
}

export async function enableBiometric() {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Finance App" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "finance-app", displayName: "Finance App" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60000
    }
  });
  write(KEY.cred, b64(credential.rawId));
}

export const disableBiometric = () => drop(KEY.cred);

async function biometricUnlock() {
  const id = read(KEY.cred);
  if (!id) return false;
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: "public-key", id: unb64(id), transports: ["internal"] }],
        userVerification: "required", timeout: 60000
      }
    });
    return true;
  } catch { return false; }
}

/* ---------- Sperrbildschirm ---------- */

function unlock() {
  overlay?.remove();
  overlay = null;
  fails = 0;
  document.documentElement.classList.remove("locked");
}

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "text") node.textContent = value; else node.setAttribute(key, value);
  }
  node.append(...children.filter(Boolean));
  return node;
}

function showLock() {
  document.documentElement.classList.add("locked");
  if (overlay) return;
  const input = h("input", { type: "password", inputmode: "numeric", autocomplete: "off", maxlength: "8", "aria-label": "PIN", class: "lock-input", placeholder: "PIN" });
  const error = h("p", { class: "lock-error", role: "alert" });
  const submit = h("button", { type: "button", class: "btn btn-primary", text: "Entsperren" });
  const bio = hasBiometric() ? h("button", { type: "button", class: "btn", text: "Mit Face ID / Fingerabdruck entsperren" }) : null;

  const tryPin = async () => {
    const wait = Math.ceil((blockedUntil - Date.now()) / 1000);
    if (wait > 0) { error.textContent = `Zu viele Versuche. Bitte ${wait} Sekunden warten.`; return; }
    if (await verifyPin(input.value)) return unlock();
    fails++;
    input.value = "";
    if (fails >= 3) blockedUntil = Date.now() + Math.min(60, 2 ** (fails - 2)) * 1000;
    error.textContent = "Falsche PIN.";
  };
  submit.addEventListener("click", tryPin);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") tryPin(); });
  bio?.addEventListener("click", async () => { if (await biometricUnlock()) unlock(); else error.textContent = "Biometrische Entsperrung fehlgeschlagen. Bitte PIN verwenden."; });

  overlay = h("div", { class: "lock", role: "dialog", "aria-modal": "true", "aria-label": "App gesperrt" },
    h("div", { class: "lock-box" }, h("h1", { text: "Finance App" }), h("p", { class: "card-note", text: "Gesperrt – bitte PIN eingeben." }), input, error, submit, bio));
  document.body.append(overlay);
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) input.focus(); // am Handy keine Tastatur erzwingen (Layout bleibt ruhig)
}

export function initSecurity() {
  if (isLockEnabled()) {
    showLock();
    if (hasBiometric()) biometricUnlock().then((ok) => ok && unlock());
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
    else if (isLockEnabled() && hiddenAt && Date.now() - hiddenAt >= getLockDelay() * 60000) showLock();
  });
}

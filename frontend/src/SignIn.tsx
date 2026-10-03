// Sign in / create account. Styled like the rest of the app (cream page, serif headline, lime accents).
import { useState, type FormEvent } from "react";
import { api } from "./lib/api";
import { photos } from "./data/mock";

export default function SignIn() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "signin") {
        await api.login(email.trim(), password);
      } else {
        const needsConfirmation = await api.signup(email.trim(), password, name.trim(), city.trim());
        if (needsConfirmation) {
          setNotice("Check your inbox to confirm your email, then sign in.");
          setMode("signin");
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = "min-h-14 w-full rounded-2xl border border-[#d9ddd5] bg-[#f8f7f2] px-4 text-sm outline-none transition focus:border-[#20251f]";
  const signup = mode === "signup";

  return <div className="min-h-screen bg-[#f8f7f2] text-[#20251f]">
    <div className="mx-auto grid min-h-screen max-w-[1440px] gap-5 p-4 sm:p-6 lg:grid-cols-2 lg:p-10">
      <section className="relative hidden overflow-hidden rounded-[32px] bg-[#222820] text-white lg:block">
        <img src={photos.hero} alt="" className="absolute inset-0 h-full w-full object-cover object-[55%_25%] opacity-90"/>
        <div className="absolute inset-0 bg-gradient-to-r from-[#172018]/95 via-[#172018]/55 to-transparent"/>
        <div className="relative z-10 flex h-full flex-col justify-end p-14">
          <h1 className="font-serif text-7xl leading-[.88] tracking-[-.045em] lg:text-[96px]">Your AI<br/><i className="font-normal text-[#d8ff60]">Stylist.</i></h1>
          <p className="mt-6 max-w-md text-base leading-7 text-white/70">Tell us where you're going. We'll style what you already own and show you exactly how it looks on you.</p>
        </div>
      </section>
      <main className="flex items-center justify-center py-10">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#d8ff60]"><svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z"/><path d="m5 15 .7 2.3L8 18l-2.3.7L5 21l-.7-2.3L2 18l2.3-.7L5 15ZM19 13l.6 1.7 1.7.6-1.7.6L19 18l-.6-2.1-1.7-.6 1.7-.6L19 13Z"/></svg></span>
            <span className="font-serif text-2xl tracking-tight">Wardrobe <i className="font-normal">AI</i></span>
          </div>
          <div className="mt-10 font-serif text-5xl tracking-tight">{signup ? "Create your account." : "Welcome back."}</div>
          <p className="mt-3 text-sm text-[#737a70]">{signup ? "Your wardrobe and looks stay private to you." : "Sign in to see your wardrobe and looks."}</p>
          <form onSubmit={submit} className="mt-8 space-y-3 rounded-[32px] border border-black/6 bg-white p-5 shadow-[0_20px_80px_rgba(28,35,27,.07)] sm:p-7">
            {signup && <>
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" className={field}/>
              <input required value={city} onChange={(e) => setCity(e.target.value)} placeholder="Your city (for weather and trends)" autoComplete="address-level2" className={field}/>
            </>}
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email" className={field}/>
            <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (6+ characters)" autoComplete={signup ? "new-password" : "current-password"} className={field}/>
            {error && <div role="alert" className="rounded-2xl bg-[#fbe9e4] px-4 py-3 text-xs text-[#9a3a22]">{error}</div>}
            {notice && <div className="rounded-2xl bg-[#eef5d4] px-4 py-3 text-xs text-[#4c5a22]">{notice}</div>}
            <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#20251f] px-5 py-3.5 text-sm font-semibold text-white transition-all duration-300 hover:bg-[#333b32] active:scale-[.98] disabled:opacity-60">
              {busy ? "Please wait..." : signup ? "Create account" : "Sign in"}
            </button>
          </form>
          <div className="mt-5 text-center text-xs text-[#737a70]">
            {signup ? "Already have an account? " : "New to Wardrobe AI? "}
            <button className="font-semibold text-[#20251f] underline underline-offset-4" onClick={() => { setMode(signup ? "signin" : "signup"); setError(""); }}>
              {signup ? "Sign in" : "Create an account"}
            </button>
          </div>
        </div>
      </main>
    </div>
  </div>;
}

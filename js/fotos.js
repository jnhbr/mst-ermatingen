/* ============================================================
   MST Ermatingen – Fotos (gemeinsam für Fotos-Seite und Startseite)

   Die Fotos liegen im Google-Drive-Ordner «MST Fotos» (Jans Konto), sortiert nach
   MST Fotos / <Jahr> / <Ordner>. Die Seite spricht über die Apps-Script-Web-App
   apps-script/fotos/Code.gs mit Drive – immer mit Login (Firebase-Token).
   ============================================================ */
const FOTOS = {
  /* URL der Apps-Script-Web-App «MST Fotos» (Bereitstellen → Web-App → …/exec) */
  API: "https://script.google.com/macros/s/AKfycbw5bzksNeFsJdpe0WforruArC6JZyAw7ifvJMTXBLIKBOXMNAWpeGfZWBZqC59V5rE2/exec",
  MAX_PX: 2400,      // längere Seite beim Hochladen
  QUALITY: 0.86,

  api(){
    // Lokal testen (private/fotos/mock-server.mjs): ?api=http://localhost:…&als=vorstand|mitglied – nur auf localhost
    if(/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
      const o = new URLSearchParams(location.search).get("api");
      if(o) return o;
    }
    return this.API;
  },
  ready(){ return !!this.api(); },
  localTest(){ return this.api() !== this.API; },

  async call(action, data){
    const idToken = this.localTest() ? "test-" + (new URLSearchParams(location.search).get("als") || "mitglied")
      : auth.currentUser ? await auth.currentUser.getIdToken() : "";
    // text/plain = «einfache» Anfrage ohne CORS-Vorabprüfung (Apps Script kann darauf nicht antworten)
    const r = await fetch(this.api(), { method:"POST", headers:{ "Content-Type":"text/plain;charset=utf-8" },
      body:JSON.stringify(Object.assign({ action, idToken }, data || {})) });
    let d;
    try{ d = await r.json(); }catch(e){ throw new Error("Google Drive gerade nicht erreichbar – bitte später nochmals versuchen."); }
    if(!d.ok) throw new Error(d.error || "Fotos nicht erreichbar");
    return d;
  },

  /* Bild-Adressen (Fotos sind «für alle mit dem Link» freigegeben) */
  img(id, w){ return this.localTest() ? `${this.api()}?img=${encodeURIComponent(id)}` : `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w || 600}`; },
  download(id){ return this.localTest() ? this.img(id) : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`; },

  /* Foto verkleinern (längere Seite MAX_PX, JPEG) → { name, mime, data:Base64 }. Kann der Browser das Format
     nicht lesen (z. B. HEIC in Chrome), geht die Originaldatei hoch. */
  async prepare(file){
    let bmp = null;
    try{ bmp = await createImageBitmap(file); }catch(e){}
    if(!bmp){
      if(file.size > 12 * 1024 * 1024) throw new Error(`${file.name}: zu gross`);
      return { name:file.name, mime:file.type || "image/jpeg", data:await this.base64(file) };
    }
    const s = Math.min(1, this.MAX_PX / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", this.QUALITY));
    return { name:file.name.replace(/\.[^.]+$/, "") + ".jpg", mime:"image/jpeg", data:await this.base64(blob) };
  },
  base64(blob){
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  }
};

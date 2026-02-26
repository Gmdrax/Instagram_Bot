(() => {
    "use strict";

    // ==========================================
    // 💀 PHANTOM CONFIG (V8.4 DM MASTER FIX)
    // ==========================================
    const CFG = {
        HASH_FOLLOWERS: "c76146de99bb02f6415203be841dd25a", HASH_FOLLOWING: "3dec7e2c57367ef3da3d987d89f9dbc8", APP_ID: "936619743392459", 
        TIMINGS: { SCAN_BASE: 1000, ACTION_BASE: 4500, DM_BASE: 8000, BATCH_PAUSE: 300000 },
        LIMITS: { SESSION: 150, DM_SESSION: 40, BATCH: 50, MAX_ERRORS: 3, CIRCUIT_BREAK_MS: 900000 },
        FILTERS: { SKIP_VERIFIED: true, SKIP_NO_PIC: true }, 
        NO_PIC_IDS: ["44884218_345707102882519_2446069589734326272_n", "464760996_1254146839119862_3605321457742435801_n"],
        SYS_ID: 'ig_core_' + Math.random().toString(36).substring(2, 12),
        CSRF: document.cookie.match(/csrftoken=([^;]+)/)?.[1] || "", WHITELIST_KEY: 'ig_phantom_whitelist'
    };

    const Utils = {
        sanitize: s => typeof s === 'string' ? Object.assign(document.createElement('div'), {textContent: s}).innerHTML : '',
        sleep: ms => new Promise(r => setTimeout(r, ms)),
        fmt: ms => ms >= 60000 ? `${Math.floor(ms/60000)}m ${Math.floor((ms%60000)/1000)}s` : `${Math.ceil(ms/1000)}s`,
        getFatigueDelay: (a, b) => Math.floor(b * (1 + (a * 0.04)) * (Math.random() * 0.5 + 0.75)),
        getUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { let r = Math.random() * 16 | 0; return (c == 'x' ? r : (r & 0x3 | 0x8)).toString(16); }),
        spinText: t => t.replace(/{([^{}]*)}/g, (m, o) => { const a = o.split('|'); return a[Math.floor(Math.random() * a.length)]; })
    };

    const EventBus = { events: {}, on(e, l) { (this.events[e] = this.events[e] || []).push(l); }, emit(e, d) { if(this.events[e]) this.events[e].forEach(l => l(d)); } };
    const ErrorHandler = { log(msg, type="info") { EventBus.emit('NEW_LOG', {t: new Date().toLocaleTimeString().split(" ")[0], msg, type}); }, handle(e, c) { this.log(e.name === 'AbortError' ? `🛑 Cancelado (${c}).` : `❌ Falla en ${c}: ${e.message}`, 'err'); } };

    const DB = {
        db: null,
        init() { return new Promise((res, rej) => { const req = indexedDB.open("PhantomV8_Core", 1); req.onupgradeneeded = e => e.target.result.createObjectStore("processed", { keyPath: "id" }); req.onsuccess = e => { this.db = e.target.result; res(); }; req.onerror = rej; }); },
        has(id) { return new Promise(res => { if(!this.db) return res(false); const r = this.db.transaction("processed", "readonly").objectStore("processed").get(id); r.onsuccess = e => res(!!e.target.result); r.onerror = () => res(false); }); },
        save(id) { if(this.db) this.db.transaction("processed", "readwrite").objectStore("processed").put({ id, timestamp: Date.now() }); }
    };

    const Store = {
        state: new Proxy({ status: "idle", mode: "follow", target: "", searchQuery: "", dmMessage: "", keywords: "", stats: { scanned: 0, success: 0, fail: 0, errs: 0, backoff: 30000 } }, { set(t, p, v) { t[p] = v; EventBus.emit(`STATE_CHANGED_${p.toUpperCase()}`, v); return true; } }),
        pool: new Map(), queue: new Set(), whitelist: new Set(JSON.parse(localStorage.getItem(CFG.WHITELIST_KEY) || '[]')),
        addWhitelist(us) { us.forEach(u => this.whitelist.add(u)); localStorage.setItem(CFG.WHITELIST_KEY, JSON.stringify([...this.whitelist])); EventBus.emit('WHITELIST_UPDATED', this.whitelist.size); },
        clearWhitelist() { this.whitelist.clear(); localStorage.removeItem(CFG.WHITELIST_KEY); EventBus.emit('WHITELIST_UPDATED', 0); },
        addPool(us) { us.forEach(u => this.pool.set(u.id, u)); EventBus.emit('POOL_UPDATED', Array.from(this.pool.values())); },
        toggleQueue(id, fs) { if(!this.pool.has(id)) return; const w = fs !== undefined ? fs : !this.queue.has(id); w ? this.queue.add(id) : this.queue.delete(id); EventBus.emit('QUEUE_TOGGLED', { id, selected: w }); },
        clearQueue() { this.queue.clear(); EventBus.emit('QUEUE_CLEARED'); }
    };

    const Net = {
        controller: new AbortController(), circuitOpenUntil: 0,
        resetController() { this.controller = new AbortController(); }, abort() { this.controller.abort(); },
        get headers() { return { "content-type": "application/x-www-form-urlencoded", "x-csrftoken": document.cookie.match(/csrftoken=([^;]+)/)?.[1] || CFG.CSRF, "x-instagram-ajax": "1", "x-ig-app-id": CFG.APP_ID, "x-requested-with": "XMLHttpRequest" }; },
        async req(url, method = "GET", body = "") {
            if (Date.now() < this.circuitOpenUntil) return { err: "LIMIT_SYSTEM" };
            const opt = { method, credentials: "include", signal: this.controller.signal, headers: this.headers };
            if (method === "POST") opt.body = body;
            
            let res; try { res = await fetch(url, opt); } catch (e) { return { err: "NETWORK" }; }
            if ([401, 403].includes(res.status)) { try { await fetch('/', {credentials:'include'}); opt.headers = this.headers; res = await fetch(url, opt); } catch(e){} }
            
            const txt = await res.text();
            let d; try { d = JSON.parse(txt); } catch(e) {}
            
            // Lector de errores nativos de Instagram (feedback_required, limits, etc.)
            if ([400, 401, 429].includes(res.status) || (d && d.status === "fail")) {
                const igMsg = d?.message || d?.feedback_message || `HTTP ${res.status}`;
                return { err: "LIMIT", retry: res.headers.get("Retry-After") ? parseInt(res.headers.get("Retry-After")) * 1000 : 60000, ig_msg: igMsg };
            }
            if (d) return d;
            return { err: txt.trim().toLowerCase().startsWith("<") ? "LIMIT" : "UNKNOWN", retry: 900000, ig_msg: "Bloqueo HTML (15m)" };
        },
        async resolve(un) { let r = await this.req(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${un}`); if(r?.data?.user?.id) return r.data.user.id; r = await this.req(`https://www.instagram.com/web/search/topsearch/?query=${un}`); return r?.users?.find(x => x.user.username === un)?.user.pk; },
        async scan(id, cur, mode) { return this.req(`https://www.instagram.com/graphql/query/?query_hash=${mode==="infieles"?CFG.HASH_FOLLOWING:CFG.HASH_FOLLOWERS}&variables=${encodeURIComponent(JSON.stringify({ id, first: CFG.LIMITS.BATCH, after: cur }))}`); },
        async getLatestFeed(uid) { const r = await this.req(`https://www.instagram.com/api/v1/feed/user/${uid}/`); return r?.err ? r : (r?.items?.[0] || null); },
        async getLatestStory(uid) { const r = await this.req(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${uid}`); return r?.err ? r : (r?.reels?.[uid]?.items?.slice(-1)[0] || null); }
    };

    const Engine = {
        async init() { try { await DB.init(); ErrorHandler.log("💽 Motor V8.4 Cargado. Protocolos de seguridad activos.", "suc"); } catch (e) { ErrorHandler.handle(e, "Arranque DB"); } },
        selfDestruct() { Store.state.status = "dead"; Net.abort(); EventBus.emit('SELF_DESTRUCT'); },
        async runScan() {
            if (!Store.state.target) return ErrorHandler.log("❌ Sin objetivo.", "err");
            Store.state.status = "scan"; Net.resetController(); 
            const rKw = Store.state.keywords.split(',').map(k=>k.trim().toLowerCase()).filter(Boolean);
            const inKw = rKw.filter(k=>!k.startsWith('!')), exKw = rKw.filter(k=>k.startsWith('!')).map(k=>k.substring(1));
            ErrorHandler.log(`🔍 Escaneando [${Store.state.mode.toUpperCase()}]: @${Store.state.target}...`);
            try {
                const id = await Net.resolve(Store.state.target); if (!id) throw new Error("Objetivo no encontrado.");
                let activeIds = new Set();
                if (Store.state.mode === "infieles") {
                    ErrorHandler.log("🕵️ Analizando interacciones profundas...", "wait");
                    const r = await Net.req(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${Store.state.target}`);
                    for (const p of (r?.data?.user?.edge_owner_to_timeline_media?.edges?.slice(0,12) || [])) {
                        const lks = await Net.req(`https://www.instagram.com/graphql/query/?query_hash=${CFG.HASH_LIKERS}&variables=${encodeURIComponent(JSON.stringify({ shortcode: p.node.shortcode, first: 50 }))}`);
                        (lks?.data?.shortcode_media?.edge_liked_by?.edges || []).forEach(l => activeIds.add(l.node.id)); await Utils.sleep(1500); 
                    }
                    ErrorHandler.log(`🛡️ Fantasmas aislados.`, "suc");
                }
                let cur = null, next = true, cycles = 0; Store.pool.clear(); Store.clearQueue();
                while (next && Store.state.status === "scan") {
                    const d = await Net.scan(id, cur, Store.state.mode);
                    if (d?.err) throw new Error(d.err === "NETWORK" ? "Error de red." : "Límite IG/Cuenta Privada.");
                    const edge = Store.state.mode === "infieles" ? d?.data?.user?.edge_follow : d?.data?.user?.edge_followed_by;
                    if (!edge) throw new Error("No se pudo extraer lista.");
                    next = edge.page_info.has_next_page; cur = edge.page_info.end_cursor; const valid = [];
                    for (const {node: u} of edge.edges) {
                        if (Store.whitelist.has(u.username) && Store.state.mode !== "message") continue;
                        if (Store.state.mode === "follow" && (u.followed_by_viewer || u.requested_by_viewer)) continue;
                        if (Store.state.mode === "infieles" && u.follows_viewer) continue; 
                        if (rKw.length > 0) {
                            const ft = `${u.full_name||""} ${u.username||""}`.toLowerCase();
                            if (exKw.some(k=>ft.includes(k)) || (inKw.length>0 && !inKw.some(k=>ft.includes(k)))) continue;
                        }
                        if (CFG.FILTERS.SKIP_VERIFIED && u.is_verified && Store.state.mode !== "message") continue;
                        if (CFG.FILTERS.SKIP_NO_PIC && (u.profile_pic_url.includes("anonymous") || CFG.NO_PIC_IDS.some(pid=>u.profile_pic_url.includes(pid)))) continue;
                        if (!(await DB.has(u.id))) valid.push(u);
                    }
                    Store.addPool(valid); Store.state.stats = { ...Store.state.stats, scanned: Store.pool.size }; 
                    if (++cycles > 6) { cycles=0; await Utils.sleep(4000+Math.random()*5000); } else await Utils.sleep(Utils.getFatigueDelay(0, CFG.TIMINGS.SCAN_BASE));
                }
                ErrorHandler.log(`✅ Escaneo listo: ${Store.pool.size} perfiles.`, "suc");
            } catch (error) { ErrorHandler.handle(error, "Escáner"); } finally { if (Store.state.status === "scan") Store.state.status = "idle"; }
        },
        async engage() {
            const targets = Array.from(Store.queue); if (!targets.length) return;
            if (Store.state.mode === "message" && !Store.state.dmMessage.trim()) return ErrorHandler.log("❌ Pon un mensaje.", "err");
            Store.state.status = "run"; Store.state.stats.backoff = 30000; Net.resetController();
            const sLimit = Store.state.mode === "message" ? CFG.LIMITS.DM_SESSION : CFG.LIMITS.SESSION, bTime = Store.state.mode === "message" ? CFG.TIMINGS.DM_BASE : CFG.TIMINGS.ACTION_BASE;
            ErrorHandler.log(`🚀 Táctica: ${Store.state.mode.toUpperCase()}`, "info");
            try {
                for (let i = 0; i < targets.length; i++) {
                    if (Store.state.status !== "run") break;
                    while (document.hidden && Store.state.status === "run") await Utils.sleep(3000); 
                    if (Store.state.stats.success >= sLimit) { ErrorHandler.log(`🛑 Límite seguro alcanzado.`, "wait"); break; }
                    const uid = targets[i], user = Store.pool.get(uid); let ok = false, aIcon = "✔️";

                    if (Store.state.mode === "boost_feed") {
                        const m = await Net.getLatestFeed(uid);
                        if (m?.err) ok = m; else if (!m) { ok = true; aIcon = "⏭️ (Sin fotos)"; } else if (m.has_liked) { ok = true; aIcon = "💖 (Ya likeada)"; } 
                        else { const pId = m.pk || m.id?.split('_')[0]; if(!pId){ok=true; aIcon="⚠️ (ID roto)";} else { const r = await Net.req(`https://www.instagram.com/api/v1/web/likes/${pId}/like/`, "POST"); ok = r?.status === "ok" ? (aIcon="❤️", true) : r||{err:"UNKNOWN"}; } }
                    } else if (Store.state.mode === "boost_story") {
                        const s = await Net.getLatestStory(uid);
                        if (s?.err) ok = s; else if (!s) { ok = true; aIcon = "⏭️ (Sin historias)"; } else if (s.has_liked) { ok = true; aIcon = "💖 (Ya likeada)"; } 
                        else { const pId = s.pk || s.id?.split('_')[0]; if(!pId){ok=true; aIcon="⚠️ (ID roto)";} else { const r = await Net.req(`https://www.instagram.com/api/v1/story_interactions/send_story_like/`, "POST", `media_id=${pId}`); ok = r?.status === "ok" ? (aIcon="🔥 (Story Like)", true) : r||{err:"UNKNOWN"}; } }
                    } else if (Store.state.mode === "message") {
                        const m = Utils.spinText(Store.state.dmMessage.replace(/@usuario/gi, user.username));
                        const uuid = Utils.getUUID();
                        const offId = Date.now().toString() + Math.floor(Math.random() * 999).toString().padStart(3, '0');
                        
                        // 🔥 FIX CRÍTICO V8.4: URLSearchParams nativo para garantizar encriptación perfecta
                        const p = new URLSearchParams();
                        p.append('recipient_users', `[["${uid}"]]`);
                        p.append('action', 'send_item');
                        p.append('is_shh_mode', '0');
                        p.append('send_attribution', 'direct_thread');
                        p.append('client_context', uuid);
                        p.append('offline_threading_id', offId);
                        p.append('mutation_token', offId);
                        p.append('text', m);

                        const r = await Net.req(`https://www.instagram.com/api/v1/direct_v2/threads/broadcast/text/`, "POST", p.toString());
                        ok = r?.err ? r : (r?.status === "ok" ? (aIcon="✉️", true) : false);
                    } else {
                        const act = Store.state.mode === "infieles" ? "unfollow" : "follow";
                        const r = await Net.req(`https://www.instagram.com/web/friendships/${uid}/${act}/`, "POST");
                        ok = r?.err ? r : (["ok", "following", "unfollowed"].includes(r?.status || r?.result) ? (aIcon=act==="follow"?"➕":"💔", true) : false);
                    }

                    if (ok === true) {
                        Store.state.stats.errs = 0; Store.state.stats.backoff = 30000; Store.toggleQueue(uid, false); Store.state.stats.success++; DB.save(uid); EventBus.emit('ITEM_PROCESSED', { id: uid, result: 'ok' }); ErrorHandler.log(`${aIcon} @${user.username}`, "suc");
                    } else {
                        Store.state.stats = { ...Store.state.stats, fail: Store.state.stats.fail + 1, errs: Store.state.stats.errs + 1 }; EventBus.emit('ITEM_PROCESSED', { id: uid, result: 'err' });
                        if (Store.state.stats.errs >= CFG.LIMITS.MAX_ERRORS) return this.selfDestruct();
                        const wt = ok.retry || Store.state.stats.backoff; 
                        ErrorHandler.log(`⚠️ Límite: ${ok.ig_msg || 'Rechazo del servidor'}. Pausa: ${Utils.fmt(wt)}.`, "err"); 
                        await Utils.sleep(wt); Store.state.stats.backoff *= 2; 
                    }
                    EventBus.emit('PROGRESS_UPDATED', ((i + 1) / targets.length) * 100); if (i === targets.length - 1 || Store.state.status === "dead") break;
                    let cd = (Store.state.stats.success > 0 && Store.state.stats.success % 5 === 0) ? CFG.TIMINGS.BATCH_PAUSE + Math.floor(Math.random()*20000) : Utils.getFatigueDelay(Store.state.stats.success, bTime);
                    if (cd > 60000) ErrorHandler.log(`🛑 Lote listo. Micro-sueño: ${Utils.fmt(cd)}`, "wait");
                    let el = 0; while (el < cd && Store.state.status === "run") { await Utils.sleep(1000); el += 1000; EventBus.emit('TIMER_UPDATED', cd - Math.min(el, cd)); }
                }
            } catch (e) { ErrorHandler.handle(e, "Motor"); } finally { if (Store.state.status !== "dead") { Store.state.status = "idle"; ErrorHandler.log("🏁 Secuencia Finalizada.", "suc"); } }
        },
        abort() { if (["scan", "run"].includes(Store.state.status)) { Net.abort(); Store.state.status = "idle"; } }
    };

    const UI = {
        dom: {}, logsArr: [],
        css: `:host{--ac:#0fe;--bg:rgba(10,10,14,.95);--txt:#e2e8f0;--mut:#64748b;--err:#f43f5e;--suc:#10b981;--wait:#fbbf24;--brd:rgba(0,255,238,.15)}.sys{font-family:system-ui,sans-serif;user-select:none;background:var(--bg);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid var(--brd);color:var(--txt);width:440px;height:740px;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.9),inset 0 0 20px rgba(0,255,238,.05);transition:.4s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;overflow:hidden}.sys.min{height:48px !important;width:48px !important;border-radius:24px;border-color:var(--ac)}.sys.max{width:90vw !important;height:90vh !important}.hd{padding:16px 20px;background:rgba(0,0,0,.4);border-bottom:1px solid var(--brd);display:flex;justify-content:space-between;align-items:center;font-weight:700}.bd{flex:1;display:flex;flex-direction:column;padding:16px;gap:10px;overflow:hidden}.inp{background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.08);color:#fff;padding:10px 14px;width:100%;box-sizing:border-box;border-radius:8px;font-size:13px;outline:0;transition:.3s}.inp:focus{border-color:var(--ac);box-shadow:0 0 12px rgba(0,255,238,.15)}.btn{background:rgba(0,255,238,.05);color:var(--ac);border:1px solid var(--brd);padding:10px;cursor:pointer;font-size:11px;font-weight:800;border-radius:8px;transition:.3s;text-transform:uppercase}.btn:hover:not(:disabled){background:var(--ac);color:#000;box-shadow:0 0 10px rgba(0,255,238,.4)}.btn:disabled{border-color:rgba(255,255,255,.05);color:var(--mut);background:0 0;cursor:not-allowed}.grd{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:16px 8px;align-content:start;padding:8px 4px}.crd{display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;opacity:.5;transition:.2s;animation:fi .3s ease-out}.crd:hover,.crd.sel{opacity:1}.img-wrap{width:64px;height:64px;flex-shrink:0;border-radius:50%;background:linear-gradient(135deg,#1e1e24,#0a0a0c);border:2px solid rgba(255,255,255,.05);display:flex;align-items:center;justify-content:center;position:relative}.avatar-txt{font-size:20px;font-weight:900;color:rgba(255,255,255,.2);text-transform:uppercase}.crd.sel .img-wrap{border-color:var(--ac);box-shadow:0 0 20px rgba(0,255,238,.3)}.crd.sel .avatar-txt{color:var(--ac)}.crd.ok{opacity:.2;filter:grayscale(1);pointer-events:none}.crd.err .img-wrap{border-color:var(--err)}.crd.err .avatar-txt{color:var(--err)}.name{width:100%;max-width:84px;font-size:11px;font-weight:600;text-align:center;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.badge{position:absolute;bottom:-4px;right:-4px;background:#111;color:#fff;font-size:10px;padding:3px;border-radius:50%;border:1.5px solid var(--err);line-height:1;width:14px;height:14px;display:flex;align-items:center;justify-content:center}.sts{display:flex;justify-content:space-between;font-size:11px;color:var(--mut);background:rgba(0,0,0,.3);padding:10px 14px;border-radius:8px;font-weight:700}.lgs{height:95px;flex-shrink:0;background:rgba(0,0,0,.6);border-radius:8px;font-size:11px;padding:12px;overflow-y:auto;color:var(--mut);font-family:monospace;border:1px solid rgba(255,255,255,.05)}.suc{color:var(--suc)}.err{color:var(--err)}.wait{color:var(--wait)}.info{color:#38bdf8}.bar{height:2px;background:rgba(255,255,255,.05);width:100%}.fil{height:100%;background:var(--ac);width:0%;transition:width .4s}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:10px}@keyframes fi{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}`,
        init() {
            document.querySelectorAll(`div[data-core="sys"]`).forEach(e => e.remove());
            const h = document.createElement('div'); h.id = CFG.SYS_ID; h.dataset.core = "sys"; h.style.cssText = 'position:fixed;bottom:25px;right:25px;z-index:2147483647;'; document.documentElement.appendChild(h); 
            const sh = h.attachShadow({ mode: 'closed' });
            sh.innerHTML = `<style>${this.css}</style><div class="sys" id="main"><div class="hd"><div style="display:flex;align-items:center;gap:8px;color:var(--ac);font-size:14px">⚡ Phantom V8.4 (DM Master Fix)</div><span id="act" style="font-size:10px;color:var(--wait)">IDLE</span><div style="display:flex;gap:12px;cursor:pointer"><span id="b-min">_</span><span id="b-max">🗖</span><span id="b-cls">✕</span></div></div><div class="bar"><div class="fil" id="prog"></div></div><div class="bd"><div style="display:flex;gap:8px"><input class="inp" id="targ" placeholder="Objetivo (@usuario)" autocomplete="off"><button class="btn" id="b-scn" style="width:110px">ESCANEAR</button></div><input class="inp" id="kwd" placeholder="Filtro (ej: bcn, !rrpp)"><div class="sts"><span>POOL: <b id="s-scn" style="color:#fff">0</b></span><span>OK: <b id="s-ok" class="suc">0</b></span><span>ERR: <b id="s-err" class="err">0</b></span></div><div style="display:flex;gap:6px"><button class="btn" style="flex:1" id="b-mod">M: FOLLOW ➕</button><button class="btn" style="flex:.4" id="b-all">ALL</button><button class="btn" style="flex:.4" id="b-prv">PRIV</button><button class="btn" style="flex:.4" id="b-pub">PUB</button><button class="btn" style="flex:.4" id="b-clr">CLR</button></div><div style="display:flex;gap:6px"><button class="btn" style="flex:1;color:#feca57;border-color:rgba(254,202,87,.2)" id="b-wht">⭐ PROTEGER</button><button class="btn" style="flex:.8;color:#ff4757;border-color:rgba(255,71,87,.2)" id="b-cwht">🗑️ VACIAR (<span id="wht-cnt">0</span>)</button></div><textarea class="inp" id="dm-msg" placeholder="Hook Spintax: {Hola|Ey} @usuario, ¿sales hoy? 🚀" style="display:none;resize:none;height:50px"></textarea><input class="inp" id="search-grid" placeholder="🔍 Buscar en la lista..."><div class="grd" id="grd"></div><div class="lgs" id="lgs"></div><div style="display:flex;gap:8px;margin-top:auto"><button class="btn" style="flex:2;padding:14px" id="b-run" disabled>INICIAR</button><button class="btn" style="flex:1;color:var(--err);border-color:rgba(244,63,94,.2)" id="b-stp">ABORTAR</button></div></div></div>`;
            const $ = s => sh.querySelector(s); this.dom = { targ: $('#targ'), scn: $('#b-scn'), run: $('#b-run'), stp: $('#b-stp'), min: $('#b-min'), max: $('#b-max'), cls: $('#b-cls'), grd: $('#grd'), lgs: $('#lgs'), s_scn: $('#s-scn'), s_ok: $('#s-ok'), s_err: $('#s-err'), act: $('#act'), prog: $('#prog'), mod: $('#b-mod'), all: $('#b-all'), prv: $('#b-prv'), pub: $('#b-pub'), clr: $('#b-clr'), wht: $('#b-wht'), cwht: $('#b-cwht'), wht_cnt: $('#wht-cnt'), search_grid: $('#search-grid'), dm_msg: $('#dm-msg'), kwd: $('#kwd'), main: $('#main') };
            this.bindEvents(); this.bindStoreEvents(); EventBus.emit('WHITELIST_UPDATED', Store.whitelist.size);
        },
        bindEvents() {
            this.dom.scn.onclick = () => Engine.runScan(); this.dom.targ.oninput = e => Store.state.target = Utils.sanitize(e.target.value.replace('@','').trim()); this.dom.kwd.oninput = e => Store.state.keywords = e.target.value; this.dom.dm_msg.oninput = e => Store.state.dmMessage = e.target.value;
            this.dom.search_grid.oninput = e => { Store.state.searchQuery = e.target.value.toLowerCase().trim(); EventBus.emit('POOL_UPDATED', Array.from(Store.pool.values())); };
            this.dom.mod.onclick = () => { const m=["follow","infieles","message","boost_feed","boost_story"]; const n = m[(m.indexOf(Store.state.mode)+1)%m.length]; Store.state.mode = n; this.dom.dm_msg.style.display = n==="message"?"block":"none"; const txts = {"boost_feed":"M: LIKE FEED 📸","boost_story":"M: LIKE STORY 🔥","infieles":"M: INFIELES 💔","message":"M: MESSAGE ✉️","follow":"M: FOLLOW ➕"}; this.dom.mod.innerText = txts[n]; };
            this.dom.all.onclick = () => Store.pool.forEach(u => Store.toggleQueue(u.id, true)); this.dom.prv.onclick = () => Store.pool.forEach(u => u.is_private && Store.toggleQueue(u.id, true)); this.dom.pub.onclick = () => Store.pool.forEach(u => !u.is_private && Store.toggleQueue(u.id, true)); this.dom.clr.onclick = () => Store.clearQueue();
            this.dom.wht.onclick = () => { const s = Array.from(Store.queue); if(!s.length) return; const un = s.map(id => Store.pool.get(id).username); Store.addWhitelist(un); s.forEach(id => Store.pool.delete(id)); Store.clearQueue(); EventBus.emit('POOL_UPDATED', Array.from(Store.pool.values())); ErrorHandler.log(`⭐ ${un.length} protegidos.`, "suc"); };
            this.dom.cwht.onclick = () => { if(confirm("¿Vaciar Whitelist?")) { Store.clearWhitelist(); ErrorHandler.log("🗑️ Vaciada.", "info"); } };
            this.dom.run.onclick = () => Engine.engage(); this.dom.stp.onclick = () => Engine.abort();
            this.dom.min.onclick = () => { this.dom.main.classList.toggle('min'); this.dom.main.classList.remove('max'); }; this.dom.max.onclick = () => { this.dom.main.classList.toggle('max'); this.dom.main.classList.remove('min'); }; this.dom.cls.onclick = () => Engine.selfDestruct();
            this.dom.grd.addEventListener('click', e => { const c = e.target.closest('.crd'); if (c && c.dataset.id && !["run", "dead"].includes(Store.state.status)) Store.toggleQueue(c.dataset.id); }, {passive: true});
        },
        bindStoreEvents() {
            EventBus.on('STATE_CHANGED_STATUS', st => { const b = ["scan","run"].includes(st); ['scn','run','targ','mod','all','prv','pub','clr','wht','cwht','search_grid','dm_msg','kwd'].forEach(k => { if(this.dom[k]) this.dom[k].disabled=b; }); if(st==="idle"){ if(this.dom.act) this.dom.act.innerText="READY"; if(this.dom.run) this.dom.run.disabled=Store.queue.size===0; } });
            EventBus.on('STATE_CHANGED_MODE', () => { if(this.dom.run) this.dom.run.disabled = Store.queue.size === 0; });
            EventBus.on('STATE_CHANGED_STATS', s => { if(this.dom.s_scn) this.dom.s_scn.innerText=s.scanned; if(this.dom.s_ok) this.dom.s_ok.innerText=s.success; if(this.dom.s_err) this.dom.s_err.innerText=s.fail; });
            EventBus.on('WHITELIST_UPDATED', s => { if(this.dom.wht_cnt) this.dom.wht_cnt.innerText=s; });
            EventBus.on('POOL_UPDATED', us => { const f=document.createDocumentFragment(); if(this.dom.grd) this.dom.grd.innerHTML=''; const q=Store.state.searchQuery; const filt = q ? us.filter(u=>u.username.toLowerCase().includes(q)) : us; filt.forEach(u => { const d=document.createElement('div'); d.className=`crd ${Store.queue.has(u.id)?'sel':''}`; d.dataset.id=u.id; d.title=`@${u.username}`; const w=document.createElement('div'); w.className='img-wrap'; const a=document.createElement('div'); a.className='avatar-txt'; a.textContent=u.username.replace(/[^a-zA-Z0-9]/g,'').substring(0,2).toUpperCase()||'IG'; w.appendChild(a); if(u.is_private){const b=document.createElement('div');b.className='badge';b.innerHTML='🔒';w.appendChild(b);} const n=document.createElement('div'); n.className='name'; n.textContent=u.username; d.append(w,n); f.appendChild(d); }); if(this.dom.grd) this.dom.grd.appendChild(f); });
            EventBus.on('QUEUE_TOGGLED', ({id, selected}) => { if(!this.dom.grd) return; const c=this.dom.grd.querySelector(`.crd[data-id="${id}"]`); if(c) selected?c.classList.add('sel'):c.classList.remove('sel'); if(this.dom.run) this.dom.run.disabled=Store.queue.size===0||Store.state.status==="run"; });
            EventBus.on('QUEUE_CLEARED', () => { if(!this.dom.grd) return; this.dom.grd.querySelectorAll('.crd.sel').forEach(el=>el.classList.remove('sel')); if(this.dom.run) this.dom.run.disabled=true; });
            EventBus.on('ITEM_PROCESSED', ({id, result}) => { if(!this.dom.grd) return; const c=this.dom.grd.querySelector(`.crd[data-id="${id}"]`); if(c){ c.classList.remove('sel'); c.classList.add(result); } });
            EventBus.on('NEW_LOG', l => { if(!this.dom.lgs) return; this.logsArr.unshift(`<div class="${l.type}" style="margin-bottom:4px;">[${l.t}] ${Utils.sanitize(l.msg)}</div>`); if(this.logsArr.length>50) this.logsArr.pop(); this.dom.lgs.innerHTML=this.logsArr.join(''); });
            EventBus.on('PROGRESS_UPDATED', p => { if(this.dom.prog) this.dom.prog.style.width=`${p}%`; }); EventBus.on('TIMER_UPDATED', ms => { if(this.dom.act) this.dom.act.innerText=`NEXT: ${Utils.fmt(ms)}`; }); EventBus.on('SELF_DESTRUCT', () => { const h=document.getElementById(CFG.SYS_ID); if(h){ h.style.opacity='0'; h.style.transform='scale(0.8) translateY(40px)'; setTimeout(()=>h.remove(),500); } });
        }
    };

    (async () => { UI.init(); await Engine.init(); ErrorHandler.log("⚡ V8.4 Master DM Fix. Seguridad reactivada.", "suc"); })();
})();
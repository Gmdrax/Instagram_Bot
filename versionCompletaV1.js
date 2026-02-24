(() => {
    "use strict";

    // ==========================================
    // 💀 PHANTOM CONFIG (V6.6 GOD MODE + FULLSCREEN + SEARCH)
    // ==========================================
    const CFG = {
        HASH_FOLLOWERS: "c76146de99bb02f6415203be841dd25a", 
        HASH_FOLLOWING: "3dec7e2c57367ef3da3d987d89f9dbc8", 
        APP_ID: "936619743392459", 
        TIMINGS: { SCAN_BASE: 1000, ACTION_BASE: 4000, BATCH_PAUSE: 300000 },
        LIMITS: { SESSION: 150, BATCH: 50, MAX_ERRORS: 3, CIRCUIT_BREAK_MS: 900000 },
        FILTERS: { SKIP_VERIFIED: true, SKIP_NO_PIC: true }, 
        NO_PIC_IDS: ["44884218_345707102882519_2446069589734326272_n", "464760996_1254146839119862_3605321457742435801_n"],
        SYS_ID: 'ig_core_' + Math.random().toString(36).substring(2, 12),
        CSRF: document.cookie.match(/csrftoken=([^;]+)/)?.[1] || "",
        WHITELIST_KEY: 'ig_phantom_whitelist'
    };

    // ==========================================
    // 🛡️ UTILS & SECURITY 
    // ==========================================
    const Utils = {
        sanitize: (str) => {
            if (typeof str !== 'string') return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },
        sleep: ms => new Promise(r => setTimeout(r, ms)),
        fmt: ms => ms >= 60000 ? `${Math.floor(ms/60000)}m ${Math.floor((ms%60000)/1000)}s` : `${Math.ceil(ms/1000)}s`,
        getFatigueDelay: (actionsDone, baseDelay) => Math.floor(baseDelay * (1 + (actionsDone * 0.04)) * (Math.random() * 0.5 + 0.75))
    };

    const EventBus = {
        events: {},
        on(event, listener) { (this.events[event] = this.events[event] || []).push(listener); },
        emit(event, data) { if (this.events[event]) this.events[event].forEach(l => l(data)); }
    };

    const ErrorHandler = {
        log(msg, type = "info") { EventBus.emit('NEW_LOG', { t: new Date().toLocaleTimeString().split(" ")[0], msg, type }); },
        handle(error, context) {
            if (error.name === 'AbortError') return this.log(`🛑 Cancelado (${context}).`, 'wait');
            this.log(`❌ Falla en ${context}: ${error.message}`, 'err');
        }
    };

    // ==========================================
    // 💽 ASYNC INDEXED-DB & STORE
    // ==========================================
    const DB = {
        db: null,
        init() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open("PhantomV6_Core", 1);
                req.onupgradeneeded = e => e.target.result.createObjectStore("processed", { keyPath: "id" });
                req.onsuccess = e => { this.db = e.target.result; resolve(); };
                req.onerror = e => reject(e);
            });
        },
        has(id) {
            return new Promise(resolve => {
                if (!this.db) return resolve(false);
                const req = this.db.transaction("processed", "readonly").objectStore("processed").get(id);
                req.onsuccess = e => resolve(!!e.target.result);
                req.onerror = () => resolve(false);
            });
        },
        save(id) {
            if (!this.db) return;
            this.db.transaction("processed", "readwrite").objectStore("processed").put({ id, timestamp: Date.now() });
        }
    };

    const Store = {
        state: new Proxy({ 
            status: "idle", mode: "follow", target: "", searchQuery: "",
            stats: { scanned: 0, success: 0, fail: 0, errs: 0, backoff: 30000 },
        }, { set(t, p, v) { t[p] = v; EventBus.emit(`STATE_CHANGED_${p.toUpperCase()}`, v); return true; } }),
        pool: new Map(), queue: new Set(),
        whitelist: new Set(JSON.parse(localStorage.getItem(CFG.WHITELIST_KEY) || '[]')),
        
        addWhitelist(usernames) {
            usernames.forEach(u => this.whitelist.add(u));
            localStorage.setItem(CFG.WHITELIST_KEY, JSON.stringify([...this.whitelist]));
            EventBus.emit('WHITELIST_UPDATED', this.whitelist.size);
        },
        clearWhitelist() {
            this.whitelist.clear();
            localStorage.removeItem(CFG.WHITELIST_KEY);
            EventBus.emit('WHITELIST_UPDATED', 0);
        },
        
        addPool(users) { users.forEach(u => this.pool.set(u.id, u)); EventBus.emit('POOL_UPDATED', Array.from(this.pool.values())); },
        toggleQueue(id, forceState) {
            if (!this.pool.has(id)) return;
            const willAdd = forceState !== undefined ? forceState : !this.queue.has(id);
            willAdd ? this.queue.add(id) : this.queue.delete(id);
            EventBus.emit('QUEUE_TOGGLED', { id, selected: willAdd });
        },
        clearQueue() { this.queue.clear(); EventBus.emit('QUEUE_CLEARED'); }
    };

    // ==========================================
    // 🌐 NETWORK LAYER (STEALTH FETCH)
    // ==========================================
    const Net = {
        controller: new AbortController(), circuitOpenUntil: 0,
        resetController() { this.controller = new AbortController(); }, abort() { this.controller.abort(); },
        get headers() { return { "content-type": "application/x-www-form-urlencoded", "x-csrftoken": CFG.CSRF, "x-instagram-ajax": "1", "x-ig-app-id": CFG.APP_ID, "x-requested-with": "XMLHttpRequest" }; },
        async healSession() {
            ErrorHandler.log("💉 Sanando sesión (Renovando tokens)...", "wait");
            try {
                await fetch('/', { credentials: 'include' });
                CFG.CSRF = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || CFG.CSRF;
                ErrorHandler.log("✅ Sesión restaurada y blindada.", "suc");
                return true;
            } catch (e) { return false; }
        },
        async req(url, method = "GET") {
            if (Date.now() < this.circuitOpenUntil) throw new Error("Cortocircuito Activo.");
            const opt = { method, credentials: "include", signal: this.controller.signal };
            opt.headers = this.headers; if (method === "POST") opt.body = "";
            let res = await fetch(url, opt);
            if (res.status === 403 && await this.healSession()) { opt.headers = this.headers; res = await fetch(url, opt); }
            if (res.status === 429 || res.status === 400) return { err: "LIMIT", retry: res.headers.get("Retry-After") ? parseInt(res.headers.get("Retry-After")) * 1000 : null };
            return await res.json();
        },
        async resolve(username) {
            let r = await this.req(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`);
            if (r?.data?.user?.id) return r.data.user.id;
            r = await this.req(`https://www.instagram.com/web/search/topsearch/?query=${username}`);
            return r?.users?.find(x => x.user.username === username)?.user.pk;
        },
        async scan(id, cursor, mode) {
            const hash = mode === "infieles" ? CFG.HASH_FOLLOWING : CFG.HASH_FOLLOWERS;
            return this.req(`https://www.instagram.com/graphql/query/?query_hash=${hash}&variables=${encodeURIComponent(JSON.stringify({ id, first: CFG.LIMITS.BATCH, after: cursor }))}`);
        },
        async action(id, type) {
            const r = await this.req(`https://www.instagram.com/web/friendships/${id}/${type}/`, "POST");
            if (r && r.err) {
                if(r.err === "LIMIT" && r.retry > 600000) { this.circuitOpenUntil = Date.now() + CFG.LIMITS.CIRCUIT_BREAK_MS; throw new Error(`Circuit Breaker: Ban detectado. Bloqueo 15 min.`); }
                return r; 
            }
            return (r && ["ok", "following", "unfollowed"].includes(r.status || r.result)) ? true : { err: "UNKNOWN" };
        }
    };

    // ==========================================
    // ⚙️ ENGINE LOGIC
    // ==========================================
    const Engine = {
        async init() { try { await DB.init(); ErrorHandler.log("💽 Motor de base de datos cargado.", "suc"); } catch (e) { ErrorHandler.handle(e, "Arranque DB"); } },
        selfDestruct() { Store.state.status = "dead"; Net.abort(); EventBus.emit('SELF_DESTRUCT'); },
        async runScan() {
            if (!Store.state.target) return ErrorHandler.log("❌ Sin objetivo.", "err");
            Store.state.status = "scan"; Net.resetController(); 
            
            if(Store.state.mode === "infieles") ErrorHandler.log(`🔍 Buscando infieles en la cuenta: @${Store.state.target}...`);
            else ErrorHandler.log(`🔍 Escaneando MODO FOLLOW: @${Store.state.target}...`);

            try {
                const id = await Net.resolve(Store.state.target);
                if (!id) throw new Error("Objetivo no encontrado.");
                let cur = null, next = true, cycles = 0; Store.pool.clear(); Store.clearQueue();
                while (next && Store.state.status === "scan") {
                    const d = await Net.scan(id, cur, Store.state.mode);
                    if (d?.err) throw new Error("Rate Limit en escaner.");
                    
                    const edge = Store.state.mode === "infieles" ? d?.data?.user?.edge_follow : d?.data?.user?.edge_followed_by;
                    if (!edge) throw new Error("API modificada por IG.");
                    
                    next = edge.page_info.has_next_page; cur = edge.page_info.end_cursor;
                    const valid = [];
                    
                    for (const e of edge.edges) {
                        const u = e.node;
                        
                        if (Store.whitelist.has(u.username)) continue;
                        if (Store.state.mode === "follow" && (u.followed_by_viewer || u.requested_by_viewer)) continue;
                        if (Store.state.mode === "infieles" && u.follows_viewer) continue; 
                        if (CFG.FILTERS.SKIP_VERIFIED && u.is_verified) continue;
                        if (CFG.FILTERS.SKIP_NO_PIC && (u.profile_pic_url.includes("anonymous") || CFG.NO_PIC_IDS.some(pid => u.profile_pic_url.includes(pid)))) continue;
                        if (!(await DB.has(u.id))) valid.push(u);
                    }
                    Store.addPool(valid); Store.state.stats = { ...Store.state.stats, scanned: Store.pool.size }; 
                    if (++cycles > 6) { cycles = 0; await Utils.sleep(Math.random() * 5000 + 4000); } else await Utils.sleep(Utils.getFatigueDelay(0, CFG.TIMINGS.SCAN_BASE));
                }
                ErrorHandler.log(`✅ Escaneo listo: ${Store.pool.size} perfiles encontrados.`, "suc");
            } catch (error) { ErrorHandler.handle(error, "Escáner"); } finally { if (Store.state.status === "scan") Store.state.status = "idle"; }
        },
        async engage() {
            const targets = Array.from(Store.queue);
            if (!targets.length) return;
            Store.state.status = "run"; Store.state.stats.backoff = 30000; Net.resetController();
            
            const internalModeAction = Store.state.mode === "infieles" ? "unfollow" : "follow";

            try {
                for (let i = 0; i < targets.length; i++) {
                    if (Store.state.status !== "run") break;
                    while (document.hidden && Store.state.status === "run") await Utils.sleep(3000); 
                    if (Store.state.stats.success >= CFG.LIMITS.SESSION) { ErrorHandler.log("🛑 Cuota segura de sesión alcanzada.", "wait"); break; }
                    
                    const uid = targets[i], user = Store.pool.get(uid);
                    const ok = await Net.action(uid, internalModeAction);
                    
                    if (ok === true) {
                        Store.state.stats.errs = 0; Store.state.stats.backoff = 30000; DB.save(uid); 
                        EventBus.emit('ITEM_PROCESSED', { id: uid, result: 'ok' }); Store.toggleQueue(uid, false); 
                        Store.state.stats = { ...Store.state.stats, success: Store.state.stats.success + 1 };
                        
                        const icon = internalModeAction === "follow" ? '➕' : '💔';
                        ErrorHandler.log(`${icon} @${user.username}`, "suc");
                    } else {
                        Store.state.stats = { ...Store.state.stats, fail: Store.state.stats.fail + 1, errs: Store.state.stats.errs + 1 };
                        EventBus.emit('ITEM_PROCESSED', { id: uid, result: 'err' });
                        if (Store.state.stats.errs >= CFG.LIMITS.MAX_ERRORS) return this.selfDestruct();
                        const waitTime = ok.retry || Store.state.stats.backoff;
                        ErrorHandler.log(`⚠️ Escudo activado. Enfriamiento: ${Utils.fmt(waitTime)}.`, "err");
                        await Utils.sleep(waitTime); Store.state.stats.backoff *= 2; 
                    }
                    EventBus.emit('PROGRESS_UPDATED', ((i + 1) / targets.length) * 100);
                    if (i === targets.length - 1 || Store.state.status === "dead") break;

                    let cd = (Store.state.stats.success > 0 && Store.state.stats.success % 5 === 0) ? CFG.TIMINGS.BATCH_PAUSE + Math.floor(Math.random() * 20000) : Utils.getFatigueDelay(Store.state.stats.success, CFG.TIMINGS.ACTION_BASE);
                    if (cd > 60000) ErrorHandler.log(`🛑 Lote listo. Micro-sueño táctico: ${Utils.fmt(cd)}`, "wait");
                    let elapsed = 0;
                    while (elapsed < cd && Store.state.status === "run") { await Utils.sleep(1000); elapsed += 1000; EventBus.emit('TIMER_UPDATED', cd - Math.min(elapsed, cd)); }
                }
            } catch (error) { ErrorHandler.handle(error, "Motor"); } finally { if (Store.state.status !== "dead") { Store.state.status = "idle"; ErrorHandler.log("🏁 Secuencia Finalizada.", "suc"); } }
        },
        abort() { if (["scan", "run"].includes(Store.state.status)) { Net.abort(); Store.state.status = "idle"; } }
    };

    // ==========================================
    // 🖥️ NANO UI (FULLSCREEN, SEARCH & PUBLIC FILTER)
    // ==========================================
    const UI = {
        dom: {}, shadow: null, logsArr: [],
        css: `:host{--ac:#0fe;--bg:rgba(10,10,14,.95);--txt:#e2e8f0;--mut:#64748b;--err:#f43f5e;--suc:#10b981;--wait:#fbbf24;--brd:rgba(0,255,238,.15)}.sys{font-family:system-ui,sans-serif;user-select:none;background:var(--bg);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid var(--brd);color:var(--txt);width:440px;height:720px;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.9),inset 0 0 20px rgba(0,255,238,.05);transition:.4s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;overflow:hidden}.sys.min{height:48px !important;width:48px !important;border-radius:24px;border-color:var(--ac);box-shadow:0 0 20px rgba(0,255,238,.2)}.sys.max{width:90vw !important;height:90vh !important}.hd{padding:16px 20px;background:rgba(0,0,0,.4);border-bottom:1px solid var(--brd);display:flex;justify-content:space-between;align-items:center;font-weight:700;letter-spacing:1px}.bd{flex:1;display:flex;flex-direction:column;padding:16px;gap:12px;overflow:hidden}.inp{background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.08);color:#fff;padding:12px 16px;width:100%;box-sizing:border-box;border-radius:8px;font-size:13px;outline:0;transition:.3s;box-shadow:inset 0 2px 4px rgba(0,0,0,.5)}.inp:focus{border-color:var(--ac);box-shadow:0 0 12px rgba(0,255,238,.15),inset 0 2px 4px rgba(0,0,0,.5)}.btn{background:rgba(0,255,238,.05);color:var(--ac);border:1px solid var(--brd);padding:10px;cursor:pointer;font-size:11px;font-weight:800;border-radius:8px;transition:.3s;text-transform:uppercase;letter-spacing:.5px}.btn:hover:not(:disabled){background:var(--ac);color:#000;box-shadow:0 0 15px rgba(0,255,238,.4),0 0 5px var(--ac)}.btn:disabled{border-color:rgba(255,255,255,.05);color:var(--mut);background:0 0;cursor:not-allowed;box-shadow:none}.grd{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:16px 8px;align-content:start;padding:8px 4px}.crd{display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;opacity:.5;transition:.2s;animation:fade-in .3s ease-out}.crd:hover{opacity:1;transform:translateY(-3px)}.img-wrap{width:64px;height:64px;flex-shrink:0;border-radius:50%;background:linear-gradient(135deg,#1e1e24,#0a0a0c);border:2px solid rgba(255,255,255,.05);box-shadow:0 4px 10px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;position:relative;transition:.3s}.avatar-txt{font-size:20px;font-weight:900;color:rgba(255,255,255,.2);text-transform:uppercase;letter-spacing:1px;transition:.3s}.crd.sel{opacity:1}.crd.sel .img-wrap{border-color:var(--ac);box-shadow:0 0 20px rgba(0,255,238,.3),inset 0 0 10px rgba(0,255,238,.1)}.crd.sel .avatar-txt{color:var(--ac);text-shadow:0 0 12px rgba(0,255,238,.6)}.crd.ok{opacity:.2;filter:grayscale(1);pointer-events:none}.crd.err .img-wrap{border-color:var(--err);box-shadow:0 0 15px rgba(244,63,94,.2)}.crd.err .avatar-txt{color:var(--err);text-shadow:0 0 10px rgba(244,63,94,.5)}.name{width:100%;max-width:84px;font-size:11px;font-weight:600;text-align:center;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.badge{position:absolute;bottom:-4px;right:-4px;background:#111;color:#fff;font-size:10px;padding:3px;border-radius:50%;border:1.5px solid var(--err);box-shadow:0 2px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;line-height:1;width:14px;height:14px}.sts{display:flex;justify-content:space-between;font-size:11px;color:var(--mut);background:rgba(0,0,0,.3);padding:12px 16px;border-radius:8px;font-weight:700;border:1px solid rgba(255,255,255,.03)}.lgs{height:115px;flex-shrink:0;background:rgba(0,0,0,.6);border-radius:8px;font-size:11px;padding:12px;overflow-y:auto;color:var(--mut);font-family:'Courier New',monospace;border:1px solid rgba(255,255,255,.05);box-shadow:inset 0 4px 10px rgba(0,0,0,.5)}.suc{color:var(--suc)}.err{color:var(--err)}.wait{color:var(--wait)}.info{color:#38bdf8}.bar{height:2px;background:rgba(255,255,255,.05);width:100%}.fil{height:100%;background:var(--ac);width:0%;transition:width .4s cubic-bezier(.4,0,.2,1);box-shadow:0 0 12px var(--ac)}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:10px}::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.3)}@keyframes fade-in{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}`,
        init() {
            document.querySelectorAll(`div[data-core="sys"]`).forEach(el => el.remove());
            const host = document.createElement('div');
            host.id = CFG.SYS_ID; host.dataset.core = "sys";
            host.style.cssText = 'position:fixed;bottom:25px;right:25px;z-index:2147483647;';
            document.documentElement.appendChild(host); 
            this.shadow = host.attachShadow({ mode: 'closed' });
            
            // HTML Structure
            this.shadow.innerHTML = `<style>${this.css}</style>
            <div class="sys" id="main">
                <div class="hd">
                    <div style="display:flex;align-items:center;gap:8px;color:var(--ac);font-size:14px">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>Phantom V6.6
                    </div>
                    <span id="act" style="font-size:10px;color:var(--wait)">IDLE</span>
                    <div style="display:flex;gap:12px;font-size:14px;">
                        <span id="b-min" style="cursor:pointer;color:var(--mut);transition:.2s" title="Minimizar">_</span>
                        <span id="b-max" style="cursor:pointer;color:var(--mut);transition:.2s" title="Pantalla Completa">🗖</span>
                        <span id="b-cls" style="cursor:pointer;color:var(--mut);transition:.2s" title="Cerrar">✕</span>
                    </div>
                </div>
                <div class="bar"><div class="fil" id="prog"></div></div>
                <div class="bd">
                    <div style="display:flex;gap:8px">
                        <input class="inp" id="targ" placeholder="Objetivo (@usuario)" autocomplete="off" spellcheck="false">
                        <button class="btn" id="b-scn" style="width:110px">ESCANEAR</button>
                    </div>
                    <div class="sts">
                        <span>POOL: <b id="s-scn" style="color:#fff">0</b></span>
                        <span>OK: <b id="s-ok" class="suc">0</b></span>
                        <span>ERR: <b id="s-err" class="err">0</b></span>
                    </div>
                    <div style="display:flex;gap:6px">
                        <button class="btn" style="flex:1; cursor:pointer; border-color:var(--brd);" id="b-mod">M: FOLLOW</button>
                        <button class="btn" style="flex:.4" id="b-all" title="Marcar Todos">ALL</button>
                        <button class="btn" style="flex:.4" id="b-prv" title="Marcar Privadas">PRIV</button>
                        <button class="btn" style="flex:.4" id="b-pub" title="Marcar Públicas">PUB</button>
                        <button class="btn" style="flex:.4" id="b-clr" title="Limpiar Marcas">CLR</button>
                    </div>
                    <!-- CONTROLES WHITELIST Y BUSCADOR -->
                    <div style="display:flex;gap:6px">
                        <button class="btn" style="flex:1; color:#feca57; border-color:rgba(254,202,87,0.2); background:rgba(254,202,87,0.05);" id="b-wht" title="Añadir a la Whitelist">⭐ PROTEGER</button>
                        <button class="btn" style="flex:.8; color:#ff4757; border-color:rgba(255,71,87,0.2); background:rgba(255,71,87,0.05);" id="b-cwht" title="Vaciar la Whitelist">🗑️ VACIAR (<span id="wht-cnt">0</span>)</button>
                    </div>
                    <div>
                        <input class="inp" id="search-grid" placeholder="🔍 Buscar usuario en la lista..." autocomplete="off" spellcheck="false" style="padding: 8px 12px;">
                    </div>
                    <div class="grd" id="grd"></div>
                    <div class="lgs" id="lgs"></div>
                    <div style="display:flex;gap:8px;margin-top:auto">
                        <button class="btn" style="flex:2;padding:14px;font-size:12px" id="b-run" disabled>INICIAR SECUENCIA</button>
                        <button class="btn" style="flex:1;color:var(--err);border-color:rgba(244,63,94,.2);background:rgba(244,63,94,.05)" id="b-stp">ABORTAR</button>
                    </div>
                </div>
            </div>`;
            
            const $ = s => this.shadow.querySelector(s);
            this.dom = { 
                targ: $('#targ'), scn: $('#b-scn'), run: $('#b-run'), stp: $('#b-stp'), 
                min: $('#b-min'), max: $('#b-max'), cls: $('#b-cls'), grd: $('#grd'), lgs: $('#lgs'), 
                s_scn: $('#s-scn'), s_ok: $('#s-ok'), s_err: $('#s-err'), act: $('#act'), 
                prog: $('#prog'), mod: $('#b-mod'), all: $('#b-all'), prv: $('#b-prv'), pub: $('#b-pub'), clr: $('#b-clr'), 
                wht: $('#b-wht'), cwht: $('#b-cwht'), wht_cnt: $('#wht-cnt'), search_grid: $('#search-grid'),
                main: $('#main') 
            };
            this.bindEvents(); 
            this.bindStoreEvents();
            
            // Inicializar contador visual de Whitelist
            EventBus.emit('WHITELIST_UPDATED', Store.whitelist.size);
        },
        bindEvents() {
            this.dom.scn.onclick = () => Engine.runScan();
            this.dom.targ.oninput = e => Store.state.target = Utils.sanitize(e.target.value.replace('@', '').trim());
            
            // Buscador interno en tiempo real
            this.dom.search_grid.oninput = (e) => {
                Store.state.searchQuery = e.target.value.toLowerCase().trim();
                EventBus.emit('POOL_UPDATED', Array.from(Store.pool.values()));
            };
            
            // Rotador de modos: FOLLOW <--> INFIEL
            this.dom.mod.onclick = () => { 
                Store.state.mode = Store.state.mode === "follow" ? "infieles" : "follow"; 
            };
            
            this.dom.all.onclick = () => Store.pool.forEach(u => Store.toggleQueue(u.id, true));
            this.dom.prv.onclick = () => Store.pool.forEach(u => u.is_private && Store.toggleQueue(u.id, true));
            this.dom.pub.onclick = () => Store.pool.forEach(u => !u.is_private && Store.toggleQueue(u.id, true));
            this.dom.clr.onclick = () => Store.clearQueue();
            
            // Guardar seleccionados en Whitelist
            this.dom.wht.onclick = () => {
                const selectedIds = Array.from(Store.queue);
                if (selectedIds.length === 0) {
                    ErrorHandler.log("⚠️ Selecciona perfiles primero para protegerlos.", "wait");
                    return;
                }
                const usernames = selectedIds.map(id => Store.pool.get(id).username);
                Store.addWhitelist(usernames);
                
                // Limpiar la grilla sacando a los ahora protegidos
                selectedIds.forEach(id => Store.pool.delete(id));
                Store.clearQueue();
                EventBus.emit('POOL_UPDATED', Array.from(Store.pool.values()));
                ErrorHandler.log(`⭐ ${usernames.length} perfiles movidos a la Lista Blanca.`, "suc");
            };

            // Limpiar la Whitelist
            this.dom.cwht.onclick = () => {
                if (confirm("¿Estás seguro de que quieres eliminar la Whitelist? Todos los perfiles dejarán de estar protegidos.")) {
                    Store.clearWhitelist();
                    ErrorHandler.log("🗑️ Lista Blanca vaciada.", "info");
                }
            };

            this.dom.run.onclick = () => Engine.engage();
            this.dom.stp.onclick = () => Engine.abort();
            
            // Controles de ventana
            this.dom.min.onclick = () => { 
                this.dom.main.classList.toggle('min'); 
                if (this.dom.main.classList.contains('max')) this.dom.main.classList.remove('max');
            };
            this.dom.max.onclick = () => {
                this.dom.main.classList.toggle('max');
                if (this.dom.main.classList.contains('min')) this.dom.main.classList.remove('min');
            };
            this.dom.cls.onclick = () => Engine.selfDestruct();
            
            this.dom.grd.addEventListener('click', e => { const c = e.target.closest('.crd'); if (c && c.dataset.id && !["run", "dead"].includes(Store.state.status)) Store.toggleQueue(c.dataset.id); }, {passive: true});
        },
        bindStoreEvents() {
            EventBus.on('STATE_CHANGED_STATUS', (status) => {
                const busy = ["scan", "run"].includes(status);
                ['scn', 'run', 'targ', 'mod', 'all', 'prv', 'pub', 'clr', 'wht', 'cwht', 'search_grid'].forEach(k => { if (this.dom[k]) this.dom[k].disabled = busy; });
                if (status === "idle") { if (this.dom.act) this.dom.act.innerText = "READY"; if (this.dom.run) this.dom.run.disabled = Store.queue.size === 0; }
            });
            EventBus.on('STATE_CHANGED_MODE', mode => { 
                if (this.dom.mod) this.dom.mod.innerText = mode === "follow" ? "M: FOLLOW" : "M: INFIELES"; 
            });
            EventBus.on('STATE_CHANGED_STATS', stats => { if (this.dom.s_scn) this.dom.s_scn.innerText = stats.scanned; if (this.dom.s_ok) this.dom.s_ok.innerText = stats.success; if (this.dom.s_err) this.dom.s_err.innerText = stats.fail; });
            
            EventBus.on('WHITELIST_UPDATED', size => { if (this.dom.wht_cnt) this.dom.wht_cnt.innerText = size; });

            EventBus.on('POOL_UPDATED', (users) => {
                const frag = document.createDocumentFragment(); if (this.dom.grd) this.dom.grd.innerHTML = ''; 
                
                // Aplicar el filtro de búsqueda
                const query = Store.state.searchQuery;
                const filteredUsers = query ? users.filter(u => u.username.toLowerCase().includes(query)) : users;

                filteredUsers.forEach(u => {
                    const div = document.createElement('div'); div.className = `crd ${Store.queue.has(u.id) ? 'sel' : ''}`; div.dataset.id = u.id; div.title = `@${u.username}`; 
                    
                    const wrap = document.createElement('div'); wrap.className = 'img-wrap';
                    const avatarTxt = document.createElement('div'); avatarTxt.className = 'avatar-txt'; 
                    avatarTxt.textContent = u.username.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || 'IG';
                    wrap.appendChild(avatarTxt);
                    
                    if (u.is_private) { 
                        const badge = document.createElement('div'); badge.className = 'badge'; badge.innerHTML = '🔒'; 
                        wrap.appendChild(badge); 
                    }
                    
                    const name = document.createElement('div'); name.className = 'name'; name.textContent = u.username;
                    
                    div.appendChild(wrap); div.appendChild(name); frag.appendChild(div);
                });
                if (this.dom.grd) this.dom.grd.appendChild(frag);
            });
            EventBus.on('QUEUE_TOGGLED', ({ id, selected }) => {
                if (!this.dom.grd) return; const card = this.dom.grd.querySelector(`.crd[data-id="${id}"]`);
                if (card) selected ? card.classList.add('sel') : card.classList.remove('sel');
                if (this.dom.run) this.dom.run.disabled = Store.queue.size === 0 || Store.state.status === "run";
            });
            EventBus.on('QUEUE_CLEARED', () => { if (!this.dom.grd) return; this.dom.grd.querySelectorAll('.crd.sel').forEach(el => el.classList.remove('sel')); if (this.dom.run) this.dom.run.disabled = true; });
            EventBus.on('ITEM_PROCESSED', ({ id, result }) => { if (!this.dom.grd) return; const card = this.dom.grd.querySelector(`.crd[data-id="${id}"]`); if (card) { card.classList.remove('sel'); card.classList.add(result); } });
            EventBus.on('NEW_LOG', (log) => {
                if (!this.dom.lgs) return; this.logsArr.unshift(`<div class="${log.type}" style="margin-bottom:4px;">[${log.t}] ${Utils.sanitize(log.msg)}</div>`);
                if(this.logsArr.length > 50) this.logsArr.pop(); this.dom.lgs.innerHTML = this.logsArr.join('');
            });
            EventBus.on('PROGRESS_UPDATED', percent => { if (this.dom.prog) this.dom.prog.style.width = `${percent}%`; });
            EventBus.on('TIMER_UPDATED', remainingMs => { if (this.dom.act) this.dom.act.innerText = `NEXT: ${Utils.fmt(remainingMs)}`; });
            EventBus.on('SELF_DESTRUCT', () => { const host = document.getElementById(CFG.SYS_ID); if(host) { host.style.opacity = '0'; host.style.transform = 'scale(0.8) translateY(40px)'; setTimeout(() => host.remove(), 500); } });
        }
    };

    // ==========================================
    // 🚀 BOOT SEQUENCE
    // ==========================================
    (async () => { UI.init(); await Engine.init(); ErrorHandler.log("⚡Phantom V6.6 Listo. FullScreen y Búsqueda Activos.", "suc"); })();
})();
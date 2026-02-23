(() => {
    "use strict";

    // ==========================================
    // 💀 PHANTOM CONFIG (V6.1 GOD MODE + EXTREME STEALTH + ADVANCED FILTERS)
    // ==========================================
    const CFG = {
        HASH_FOLLOWERS: "c76146de99bb02f6415203be841dd25a", 
        HASH_FOLLOWING: "3dec7e2c57367ef3da3d987d89f9dbc8", 
        APP_ID: "936619743392459", 
        TIMINGS: { 
            SCAN_BASE: 1000, 
            ACTION_BASE: 4000,
            BATCH_PAUSE: 300000 // 5 Minutos de pausa estricta (300,000 ms)
        },
        LIMITS: { SESSION: 50, BATCH: 50, MAX_ERRORS: 3, CIRCUIT_BREAK_MS: 900000 },
        NO_PIC_IDS: ["44884218_345707102882519_2446069589734326272_n", "464760996_1254146839119862_3605321457742435801_n"],
        SYS_ID: 'ig_sys_' + Math.random().toString(36).substring(2, 10),
        CSRF: document.cookie.match(/csrftoken=([^;]+)/)?.[1] || "",
        KEYS: { WHITELIST: "ghost_v6_whitelist" }
    };

    // ==========================================
    // 🛡️ UTILS, SECURITY & FATIGUE (JITTER)
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
        getFatigueDelay: (actionsDone, baseDelay) => {
            const fatigueMultiplier = 1 + (actionsDone * 0.05); 
            const jitter = Math.random() * 0.4 + 0.8; 
            return Math.floor(baseDelay * fatigueMultiplier * jitter);
        },
        exportJSON: (data, filename) => {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a); URL.revokeObjectURL(url);
        },
        importJSON: (callback) => {
            const input = document.createElement("input");
            input.type = "file"; input.accept = ".json";
            input.onchange = e => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => {
                    try { callback(JSON.parse(ev.target.result)); } 
                    catch (err) { ErrorHandler.log("❌ Archivo JSON corrupto", "err"); }
                };
                reader.readAsText(file);
            };
            input.click();
        },
        copyToClipboard: (text) => {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            ErrorHandler.log("📋 Lista copiada al portapapeles", "suc");
        }
    };

    // ==========================================
    // 📡 EVENT BUS (PUB/SUB)
    // ==========================================
    const EventBus = {
        events: {},
        on(event, listener) {
            if (!this.events[event]) this.events[event] = [];
            this.events[event].push(listener);
        },
        emit(event, data) {
            if (this.events[event]) this.events[event].forEach(l => l(data));
        }
    };

    const ErrorHandler = {
        log(msg, type = "info") { EventBus.emit('NEW_LOG', { t: new Date().toLocaleTimeString().split(" ")[0], msg, type }); },
        handle(error, context) {
            if (error.name === 'AbortError') return this.log(`🛑 Cancelado (${context}).`, 'wait');
            this.log(`❌ Falla en ${context}: ${error.message}`, 'err');
        }
    };

    // ==========================================
    // 💽 ASYNC INDEXED-DB (INDUSTRIAL MEMORY)
    // ==========================================
    const DB = {
        db: null,
        init() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open("PhantomV6_Memory", 1);
                req.onupgradeneeded = e => e.target.result.createObjectStore("processed", { keyPath: "id" });
                req.onsuccess = e => { this.db = e.target.result; resolve(); };
                req.onerror = e => reject(e);
            });
        },
        has(id) {
            return new Promise(resolve => {
                if (!this.db) return resolve(false);
                const tx = this.db.transaction("processed", "readonly");
                const req = tx.objectStore("processed").get(id);
                req.onsuccess = e => resolve(!!e.target.result);
                req.onerror = () => resolve(false);
            });
        },
        save(id) {
            if (!this.db) return;
            const tx = this.db.transaction("processed", "readwrite");
            tx.objectStore("processed").put({ id, timestamp: Date.now() });
            tx.oncomplete = () => {
                const countTx = this.db.transaction("processed", "readonly").objectStore("processed").count();
                countTx.onsuccess = e => {
                    if (e.target.result > 10000) this.db.transaction("processed", "readwrite").objectStore("processed").clear();
                };
            };
        }
    };

    // ==========================================
    // 🧠 REACTIVE STORE & ADVANCED FILTERS
    // ==========================================
    const createReactiveState = (initialState) => {
        return new Proxy(initialState, {
            set(target, property, value) {
                target[property] = value;
                EventBus.emit(`STATE_CHANGED_${property.toUpperCase()}`, value);
                return true;
            }
        });
    };

    const initialWhitelist = JSON.parse(localStorage.getItem(CFG.KEYS.WHITELIST) || "[]");

    const Store = {
        state: createReactiveState({ 
            status: "idle", mode: "unfollow", target: "", 
            stats: { scanned: 0, success: 0, fail: 0, errs: 0, backoff: 30000 },
            filters: {
                showNonFollowers: true, // "No me siguen"
                showFollowers: false,   // "Me siguen"
                showVerified: true,
                showPrivate: true,
                showNoPic: true,
                showWhitelistedOnly: false // Pestaña de lista blanca
            },
            searchQuery: ""
        }),
        pool: new Map(), queue: new Set(),
        whitelist: new Set(initialWhitelist.map(u => u.id)),
        whitelistData: new Map(initialWhitelist.map(u => [u.id, u])),
        
        addPool(users) {
            users.forEach(u => this.pool.set(u.id, u));
            EventBus.emit('POOL_UPDATED');
        },
        toggleQueue(id, forceState) {
            if (!this.pool.has(id)) return;
            if (this.whitelist.has(id) && forceState !== false) return; // Protege la whitelist
            const willAdd = forceState !== undefined ? forceState : !this.queue.has(id);
            willAdd ? this.queue.add(id) : this.queue.delete(id);
            EventBus.emit('QUEUE_TOGGLED', { id, selected: willAdd });
        },
        toggleWhitelist(user) {
            if (this.whitelist.has(user.id)) {
                this.whitelist.delete(user.id);
                this.whitelistData.delete(user.id);
            } else {
                this.whitelist.add(user.id);
                this.whitelistData.set(user.id, user);
                this.queue.delete(user.id); // Si está en cola, lo saca por seguridad
            }
            localStorage.setItem(CFG.KEYS.WHITELIST, JSON.stringify(Array.from(this.whitelistData.values())));
            EventBus.emit('POOL_UPDATED'); // Forzar render para actualizar el icono de estrella
        },
        clearQueue() { this.queue.clear(); EventBus.emit('QUEUE_CLEARED'); },
        
        getFilteredPool() {
            const f = this.state.filters;
            const q = this.state.searchQuery.toLowerCase();
            return Array.from(this.pool.values()).filter(e => {
                // Lógica exacta extraída del React original
                const isWhitelisted = this.whitelist.has(e.id);
                if (f.showWhitelistedOnly && !isWhitelisted) return false;
                if (!f.showWhitelistedOnly && isWhitelisted) return false;
                
                if (!f.showPrivate && e.is_private) return false;
                if (!f.showVerified && e.is_verified) return false;
                if (!f.showFollowers && e.follows_viewer) return false; // follows_viewer = true -> Me sigue
                if (!f.showNonFollowers && !e.follows_viewer) return false; // follows_viewer = false -> No me sigue
                if (!f.showNoPic && CFG.NO_PIC_IDS.some(id => e.profile_pic_url.includes(id))) return false;
                if (q && !e.username.toLowerCase().includes(q) && !(e.full_name||"").toLowerCase().includes(q)) return false;
                
                return true;
            });
        }
    };

    // ==========================================
    // 🌐 V6 NETWORK LAYER (HEALER, BREAKER & BLOB CACHE)
    // ==========================================
    const Net = {
        controller: new AbortController(),
        circuitOpenUntil: 0,

        resetController() { this.controller = new AbortController(); },
        abort() { this.controller.abort(); },

        get headers() {
            return {
                "content-type": "application/x-www-form-urlencoded",
                "x-csrftoken": CFG.CSRF,
                "x-instagram-ajax": "1",
                "x-ig-app-id": CFG.APP_ID, 
                "x-requested-with": "XMLHttpRequest"
            };
        },

        async healSession() {
            ErrorHandler.log("💉 Sanando sesión (Renovando tokens)...", "wait");
            try {
                const r = await fetch('/', { credentials: 'include' });
                CFG.CSRF = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || CFG.CSRF;
                ErrorHandler.log("✅ Sesión restaurada.", "suc");
                return true;
            } catch (e) { return false; }
        },

        async fetchImageBlob(url) {
            try {
                const res = await fetch(url, { mode: 'no-cors', signal: this.controller.signal });
                const blob = await res.blob();
                return URL.createObjectURL(blob);
            } catch (e) { return null; }
        },

        async req(url, method = "GET") {
            if (Date.now() < this.circuitOpenUntil) throw new Error("Cortocircuito Activo.");

            const opt = { method, credentials: "include", signal: this.controller.signal };
            if (method === "POST") { opt.headers = this.headers; opt.body = ""; } 
            else opt.headers = this.headers;
            
            let res = await fetch(url, opt);
            if (res.status === 403) {
                if (await this.healSession()) {
                    opt.headers = this.headers; res = await fetch(url, opt); 
                }
            }
            if (res.status === 429 || res.status === 400) {
                const retryAfter = res.headers.get("Retry-After");
                return { err: "LIMIT", retry: retryAfter ? parseInt(retryAfter) * 1000 : null };
            }
            return await res.json();
        },

        async resolve(username) {
            let r = await this.req(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`);
            if (r?.data?.user?.id) return r.data.user.id;
            r = await this.req(`https://www.instagram.com/web/search/topsearch/?query=${username}`);
            return r?.users?.find(x => x.user.username === username)?.user.pk;
        },

        async scan(id, cursor, mode) {
            const hash = mode === "unfollow" ? CFG.HASH_FOLLOWING : CFG.HASH_FOLLOWERS;
            const vars = encodeURIComponent(JSON.stringify({ id, first: CFG.LIMITS.BATCH, after: cursor }));
            return this.req(`https://www.instagram.com/graphql/query/?query_hash=${hash}&variables=${vars}`);
        },

        async action(id, type) {
            const r = await this.req(`https://www.instagram.com/web/friendships/${id}/${type}/`, "POST");
            if (r && r.err) {
                if(r.err === "LIMIT" && r.retry && r.retry > 600000) {
                    this.circuitOpenUntil = Date.now() + CFG.LIMITS.CIRCUIT_BREAK_MS;
                    throw new Error(`Ban detectado. Cortocircuito 15 min.`);
                }
                return r; 
            }
            return (r && ["ok", "following", "unfollowed"].includes(r.status || r.result)) ? true : { err: "UNKNOWN" };
        }
    };

    // ==========================================
    // ⚙️ ENGINE LOGIC
    // ==========================================
    const Engine = {
        async init() {
            try {
                await DB.init();
                this.extractDynamicHashes();
            } catch (e) { ErrorHandler.handle(e, "Arranque DB"); }
        },

        extractDynamicHashes() {
            for (let script of document.scripts) {
                if (script.src && script.src.includes('Consumer')) {/* Silent check */}
            }
        },

        selfDestruct() {
            Store.state.status = "dead"; Net.abort(); EventBus.emit('SELF_DESTRUCT');
        },

        async runScan() {
            if (!Store.state.target) return ErrorHandler.log("❌ Sin objetivo.", "err");
            Store.state.status = "scan";
            Net.resetController();
            ErrorHandler.log(`🔍 Escaneando V6.1: @${Store.state.target}...`);
            
            try {
                const id = await Net.resolve(Store.state.target);
                if (!id) throw new Error("Objetivo no encontrado.");

                let cur = null, next = true, cycles = 0;
                Store.pool.clear(); Store.clearQueue();
                
                while (next && Store.state.status === "scan") {
                    const d = await Net.scan(id, cur, Store.state.mode);
                    if (d?.err) throw new Error("Rate Limit alcanzado.");
                    
                    const edge = Store.state.mode === "unfollow" ? d?.data?.user?.edge_follow : d?.data?.user?.edge_followed_by;
                    if (!edge) throw new Error("Estructura de API desconocida.");

                    next = edge.page_info.has_next_page;
                    cur = edge.page_info.end_cursor;
                    
                    const valid = [];
                    for (const e of edge.edges) {
                        const u = e.node;
                        // follows_viewer detecta mágicamente los non-followers desde la API
                        const isProcessed = await DB.has(u.id);
                        if (!isProcessed) valid.push(u);
                    }

                    Store.addPool(valid);
                    Store.state.stats = { ...Store.state.stats, scanned: Store.pool.size }; 

                    if (++cycles > 6) {
                        cycles = 0;
                        await Utils.sleep(Math.random() * 5000 + 5000); 
                    } else {
                        await Utils.sleep(Utils.getFatigueDelay(0, CFG.TIMINGS.SCAN_BASE));
                    }
                }
                ErrorHandler.log(`✅ Escaneo de Red listo: ${Store.pool.size} perfiles.`, "suc");
            } catch (error) { ErrorHandler.handle(error, "Escáner"); } 
            finally { if (Store.state.status === "scan") Store.state.status = "idle"; }
        },

        async engage() {
            const targets = Array.from(Store.queue);
            if (!targets.length) return;
            
            Store.state.status = "run";
            Store.state.stats.backoff = 30000; 
            Net.resetController();
            
            try {
                for (let i = 0; i < targets.length; i++) {
                    if (Store.state.status !== "run") break;
                    while (document.hidden && Store.state.status === "run") await Utils.sleep(3000); 
                    
                    if (Store.state.stats.success >= CFG.LIMITS.SESSION) {
                        ErrorHandler.log("🛑 Cuota de sesión finalizada.", "wait"); break;
                    }
                    
                    const uid = targets[i];
                    const user = Store.pool.get(uid);
                    
                    const ok = await Net.action(uid, Store.state.mode);
                    
                    if (ok === true) {
                        Store.state.stats.errs = 0; 
                        Store.state.stats.backoff = 30000; 
                        DB.save(uid); 
                        
                        EventBus.emit('ITEM_PROCESSED', { id: uid, result: 'ok' });
                        Store.toggleQueue(uid, false); 
                        Store.state.stats = { ...Store.state.stats, success: Store.state.stats.success + 1 };
                        ErrorHandler.log(`[SUCCESS] ${Store.state.mode==="follow"?'➕':'➖'} @${user.username}`, "suc");
                    } else {
                        Store.state.stats = { ...Store.state.stats, fail: Store.state.stats.fail + 1, errs: Store.state.stats.errs + 1 };
                        EventBus.emit('ITEM_PROCESSED', { id: uid, result: 'err' });
                        ErrorHandler.log(`[FAIL] Fallo en @${user.username}`, "err");
                        
                        if (Store.state.stats.errs >= CFG.LIMITS.MAX_ERRORS) return this.selfDestruct();
                        
                        const waitTime = ok.retry || Store.state.stats.backoff;
                        ErrorHandler.log(`⚠️ Limitador activado. Esperando ${Utils.fmt(waitTime)}.`, "err");
                        await Utils.sleep(waitTime);
                        Store.state.stats.backoff *= 2; 
                    }

                    EventBus.emit('PROGRESS_UPDATED', ((i + 1) / targets.length) * 100);
                    if (i === targets.length - 1 || Store.state.status === "dead") break;

                    // LÓGICA DE PAUSA SEGURA (5x5 RULE)
                    let cd = 0;
                    if (Store.state.stats.success > 0 && Store.state.stats.success % 5 === 0) {
                        cd = CFG.TIMINGS.BATCH_PAUSE + Math.floor(Math.random() * 20000);
                        ErrorHandler.log(`🛑 Lote de 5 alcanzado. Pausa táctica: ${Utils.fmt(cd)}`, "wait");
                    } else {
                        cd = Utils.getFatigueDelay(Store.state.stats.success, CFG.TIMINGS.ACTION_BASE);
                    }

                    let elapsed = 0;
                    while (elapsed < cd && Store.state.status === "run") {
                        await Utils.sleep(1000);
                        elapsed += 1000;
                        EventBus.emit('TIMER_UPDATED', cd - Math.min(elapsed, cd));
                    }
                }
            } catch (error) { ErrorHandler.handle(error, "Motor"); } 
            finally { 
                if (Store.state.status !== "dead") {
                    Store.state.status = "idle";
                    ErrorHandler.log("🏁 Operación Finalizada.", "suc");
                }
            }
        },
        abort() { if (["scan", "run"].includes(Store.state.status)) { Net.abort(); Store.state.status = "idle"; } }
    };

    // ==========================================
    // 🖥️ NANO UI (LAZY LOADING & ADVANCED PANELS)
    // ==========================================
    const UI = {
        dom: {}, shadow: null, logsArr: [], observer: null,
        css: `
            :host { --ac: #00ffcc; --bg: rgba(10, 10, 12, 0.98); --c-bg: rgba(20, 20, 24, 0.8); --txt: #e0e0e0; --mut: #888; --err: #ff4757; --suc: #2ed573; --wl: #feca57; --brd: rgba(0, 255, 204, 0.2); }
            .sys { font-family: system-ui, sans-serif; user-select: none; background: var(--bg); backdrop-filter: blur(20px); border: 1px solid var(--brd); color: var(--txt); width: 450px; height: 740px; border-radius: 12px; box-shadow: 0 30px 60px rgba(0,0,0,0.9); transition: 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); display: flex; flex-direction: column; }
            .sys.min { height: 48px; width: 48px; border-radius: 24px; cursor: pointer; overflow: hidden; border-color: var(--ac); }
            .hd { padding: 14px 20px; background: rgba(0,0,0,0.5); border-bottom: 1px solid var(--brd); display: flex; justify-content: space-between; align-items: center; font-weight: 700; letter-spacing: 0.5px; }
            .bd { flex: 1; display: flex; flex-direction: column; padding: 16px; gap: 10px; overflow: hidden; }
            .inp { background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.05); color: #fff; padding: 12px; width: 100%; box-sizing: border-box; border-radius: 6px; font-size: 13px; outline: none; transition: 0.2s;}
            .inp:focus { border-color: var(--ac); box-shadow: 0 0 10px rgba(0,255,204,0.1); }
            .btn { background: rgba(0,255,204,0.05); color: var(--ac); border: 1px solid var(--brd); padding: 10px; cursor: pointer; font-size: 11px; font-weight: 800; border-radius: 6px; transition: 0.2s; text-transform: uppercase;}
            .btn:hover:not(:disabled) { background: var(--ac); color: #000; box-shadow: 0 0 15px rgba(0,255,204,0.4);}
            .btn:disabled { border-color: #333; color: #555; background: transparent; cursor: not-allowed; }
            .panel { display: none; background: rgba(0,0,0,0.4); border-radius: 6px; padding: 10px; border: 1px solid rgba(255,255,255,0.05); flex-direction: column; gap: 8px;}
            .panel.open { display: flex; }
            .flt-lbl { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--txt); cursor:pointer;}
            .grd { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; align-content: start; padding-right: 4px;}
            .crd { width: 100%; aspect-ratio: 1; background: var(--c-bg); position: relative; cursor: pointer; border: 2px solid transparent; border-radius: 6px; overflow: hidden; opacity: 0.5; transition: 0.2s; box-sizing: border-box; }
            .crd:hover { opacity: 1; transform: translateY(-2px); z-index: 2; box-shadow: 0 5px 10px rgba(0,0,0,0.5);}
            .crd.sel { border-color: var(--ac); opacity: 1; }
            .crd.wl { border-color: var(--wl) !important; opacity: 1; }
            .crd.ok { border-color: var(--suc); opacity: 1; filter: grayscale(100%); pointer-events:none;}
            .crd.err { border-color: var(--err); opacity: 1; }
            .crd img { width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; opacity: 0; transition: opacity 0.3s; }
            .crd img.loaded { opacity: 1; }
            .crd-star { position: absolute; top: 4px; left: 4px; z-index: 3; font-size: 14px; text-shadow: 0 2px 4px rgba(0,0,0,0.8); cursor: pointer; transition: 0.2s; color: rgba(255,255,255,0.3);}
            .crd-star:hover { transform: scale(1.2); color: #fff;}
            .crd.wl .crd-star { color: var(--wl); }
            .sts { display: flex; justify-content: space-between; font-size: 11px; color: var(--mut); background: rgba(0,0,0,0.4); padding: 10px 14px; border-radius: 6px; font-weight: 600;}
            .lgs { height: 120px; flex-shrink: 0; background: rgba(0,0,0,0.8); border-radius: 6px; font-size: 11px; padding: 12px; overflow-y: auto; color: var(--mut); font-family: "Fira Code", monospace; border: 1px solid rgba(255,255,255,0.05);}
            .suc { color: var(--suc); } .err { color: var(--err); } .wait { color: #feca57; } .info { color: #48dbfb; }
            .bar { height: 2px; background: rgba(255,255,255,0.02); width: 100%; }
            .fil { height: 100%; background: var(--ac); width: 0%; transition: width 0.4s ease, box-shadow 0.4s; box-shadow: 0 0 10px var(--ac);}
            ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        `,
        init() {
            document.querySelectorAll('div[data-pht="1"]').forEach(el => el.remove());
            const host = document.createElement('div');
            host.id = CFG.SYS_ID; host.dataset.pht = "1";
            host.style.cssText = 'position:fixed; bottom:25px; right:25px; z-index:2147483647;';
            document.documentElement.appendChild(host); 

            this.shadow = host.attachShadow({ mode: 'closed' });
            this.shadow.innerHTML = `<style>${this.css}</style>
                <div class="sys" id="main">
                    <div class="hd">
                        <div style="display:flex; align-items:center; gap:8px; color:var(--ac); font-size:14px">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                            GOD MODE V6.1 + WL
                        </div>
                        <span id="act" style="font-size:10px; color:#feca57;">IDLE</span>
                        <div style="display:flex; gap:12px;">
                            <span id="b-min" style="cursor:pointer; color:var(--mut);">_</span>
                            <span id="b-cls" style="cursor:pointer; color:var(--mut);">✕</span>
                        </div>
                    </div>
                    <div class="bar"><div class="fil" id="prog"></div></div>
                    <div class="bd">
                        <div style="display:flex; gap:8px">
                            <input class="inp" id="targ" placeholder="@mi_cuenta" autocomplete="off" spellcheck="false" value="@me">
                            <button class="btn" id="b-scn" style="width:100px;">SCAN</button>
                            <button class="btn" id="b-cfg" style="width:40px; padding:0; font-size:16px;">⚙️</button>
                        </div>
                        
                        <div class="panel" id="p-cfg">
                            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                                <label class="flt-lbl"><input type="checkbox" id="f-nf" checked> No me siguen</label>
                                <label class="flt-lbl"><input type="checkbox" id="f-f"> Me siguen</label>
                                <label class="flt-lbl"><input type="checkbox" id="f-v" checked> Verificados</label>
                                <label class="flt-lbl"><input type="checkbox" id="f-p" checked> Privados</label>
                                <label class="flt-lbl"><input type="checkbox" id="f-np" checked> Sin foto</label>
                                <label class="flt-lbl" style="color:var(--wl)"><input type="checkbox" id="f-wl"> Solo Whitelist</label>
                            </div>
                            <div style="display:flex; gap:4px; margin-top:4px;">
                                <button class="btn" style="flex:1" id="b-wli">📥 IMP WL</button>
                                <button class="btn" style="flex:1" id="b-wle">📤 EXP WL</button>
                                <button class="btn" style="flex:1; border-color:var(--mut); color:var(--txt)" id="b-wlc">🗑️ CLR WL</button>
                                <button class="btn" style="flex:1" id="b-cpy">📋 COPY</button>
                            </div>
                        </div>

                        <div class="sts">
                            <span>VISTOS: <b id="s-scn" style="color:#fff">0</b></span>
                            <span>SEL: <b id="s-sel" style="color:#fff">0</b></span>
                            <span>WL: <b id="s-wl" style="color:var(--wl)">0</b></span>
                            <span>OK: <b id="s-ok" class="suc">0</b></span>
                            <span>ERR: <b id="s-err" class="err">0</b></span>
                        </div>
                        <div style="display:flex; gap:6px;">
                            <input class="inp" id="f-txt" placeholder="Filtrar nombre..." style="flex:2; padding:8px;">
                            <button class="btn" style="flex:1" id="b-mod">UNFOLLOW</button>
                            <button class="btn" style="flex:0.5" id="b-all">ALL</button>
                            <button class="btn" style="flex:0.5" id="b-clr">CLR</button>
                        </div>
                        <div class="grd" id="grd"></div>
                        <div class="lgs" id="lgs"></div>
                        <div style="display:flex; gap:8px; margin-top:auto;">
                            <button class="btn" style="flex:2; padding:12px; font-size:12px;" id="b-run" disabled>INICIAR SECUENCIA</button>
                            <button class="btn" style="flex:1; color:var(--err); border-color:rgba(255,71,87,0.2); background:rgba(255,71,87,0.05);" id="b-stp">ABORTAR</button>
                        </div>
                    </div>
                </div>`;
            
            const $ = s => this.shadow.querySelector(s);
            this.dom = {
                targ: $('#targ'), scn: $('#b-scn'), cfgBtn: $('#b-cfg'), cfgPan: $('#p-cfg'),
                fTxt: $('#f-txt'),
                fNF: $('#f-nf'), fF: $('#f-f'), fV: $('#f-v'), fP: $('#f-p'), fNP: $('#f-np'), fWL: $('#f-wl'),
                bWLI: $('#b-wli'), bWLE: $('#b-wle'), bWLC: $('#b-wlc'), bCpy: $('#b-cpy'),
                run: $('#b-run'), stp: $('#b-stp'), min: $('#b-min'), cls: $('#b-cls'), 
                grd: $('#grd'), lgs: $('#lgs'),
                s_scn: $('#s-scn'), s_sel: $('#s-sel'), s_wl: $('#s-wl'), s_ok: $('#s-ok'), s_err: $('#s-err'), act: $('#act'),
                prog: $('#prog'), mod: $('#b-mod'), all: $('#b-all'), clr: $('#b-clr'), main: $('#main')
            };

            this.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src && !img.src) {
                            Net.fetchImageBlob(img.dataset.src).then(url => {
                                if (url) { img.src = url; img.classList.add('loaded'); }
                            });
                            this.observer.unobserve(img);
                        }
                    }
                });
            }, { root: this.dom.grd, rootMargin: '100px' });

            this.bindEvents();
            this.bindStoreEvents();
            
            // Inicializar contadores visuales iniciales
            this.dom.s_wl.innerText = Store.whitelist.size;
        },

        bindEvents() {
            const d = this.dom;
            d.scn.onclick = () => {
                // Truco para mapear @me
                if(Store.state.target === '@me' || Store.state.target === '') {
                    const match = document.cookie.match(/ds_user_id=([^;]+)/);
                    if(match) Store.state.target = match[1];
                }
                Engine.runScan();
            };
            d.targ.oninput = e => Store.state.target = Utils.sanitize(e.target.value.replace('@', '').trim());
            d.cfgBtn.onclick = () => d.cfgPan.classList.toggle('open');
            d.mod.onclick = () => {
                Store.state.mode = Store.state.mode === "follow" ? "unfollow" : "follow";
                d.mod.innerText = Store.state.mode.toUpperCase();
            };
            
            // Bindear los filtros al estado
            const bindFilter = (el, key) => { el.onchange = e => { Store.state.filters = { ...Store.state.filters, [key]: e.target.checked }; EventBus.emit('POOL_UPDATED'); };};
            bindFilter(d.fNF, 'showNonFollowers'); bindFilter(d.fF, 'showFollowers');
            bindFilter(d.fV, 'showVerified'); bindFilter(d.fP, 'showPrivate');
            bindFilter(d.fNP, 'showNoPic'); bindFilter(d.fWL, 'showWhitelistedOnly');
            
            d.fTxt.oninput = e => { Store.state.searchQuery = Utils.sanitize(e.target.value); EventBus.emit('POOL_UPDATED'); };

            // Seleccionar todo (respetando filtros visuales)
            d.all.onclick = () => {
                const visible = Store.getFilteredPool();
                visible.forEach(u => { if(!Store.whitelist.has(u.id)) Store.toggleQueue(u.id, true); });
            };
            d.clr.onclick = () => Store.clearQueue();
            d.run.onclick = () => Engine.engage();
            d.stp.onclick = () => Engine.abort();
            
            // Botones Whitelist
            d.bWLE.onclick = () => Utils.exportJSON(Array.from(Store.whitelistData.values()), `ig_whitelist_${new Date().getTime()}.json`);
            d.bWLI.onclick = () => Utils.importJSON(data => {
                if(Array.isArray(data)) {
                    data.forEach(u => { Store.whitelist.add(u.id); Store.whitelistData.set(u.id, u); });
                    localStorage.setItem(CFG.KEYS.WHITELIST, JSON.stringify(Array.from(Store.whitelistData.values())));
                    ErrorHandler.log(`📥 Importados ${data.length} a WL.`, "suc");
                    EventBus.emit('POOL_UPDATED');
                }
            });
            d.bWLC.onclick = () => {
                if(confirm("¿Vaciar Whitelist?")) {
                    Store.whitelist.clear(); Store.whitelistData.clear();
                    localStorage.removeItem(CFG.KEYS.WHITELIST);
                    ErrorHandler.log(`🗑️ Whitelist vaciada.`, "suc");
                    EventBus.emit('POOL_UPDATED');
                }
            };
            d.bCpy.onclick = () => {
                const names = Store.getFilteredPool().map(u => u.username).join('\n');
                Utils.copyToClipboard(names);
            };

            d.min.onclick = () => {
                const isMin = d.main.classList.toggle('min');
                d.main.style.height = isMin ? '48px' : '740px';
                d.main.style.width = isMin ? '48px' : '450px';
            };
            d.cls.onclick = () => Engine.selfDestruct();
            
            // Delegación de eventos para las cartas (Click normal -> Seleccionar. Click estrella -> Whitelist)
            d.grd.addEventListener('click', e => {
                const star = e.target.closest('.crd-star');
                const crd = e.target.closest('.crd');
                if (!crd || !crd.dataset.id || ["run", "dead"].includes(Store.state.status)) return;
                
                const u = Store.pool.get(crd.dataset.id);
                if (star) {
                    Store.toggleWhitelist(u);
                } else {
                    Store.toggleQueue(u.id);
                }
            }, {passive: true});
        },

        bindStoreEvents() {
            EventBus.on('STATE_CHANGED_STATUS', (status) => {
                const busy = ["scan", "run"].includes(status);
                ['scn', 'run', 'targ', 'all', 'clr', 'bWLI', 'bWLC'].forEach(k => {
                    if (this.dom[k]) this.dom[k].disabled = busy;
                });
                if (status === "idle") {
                    if (this.dom.act) this.dom.act.innerText = "READY";
                    if (this.dom.run) this.dom.run.disabled = Store.queue.size === 0;
                }
            });

            EventBus.on('STATE_CHANGED_STATS', stats => {
                if (this.dom.s_ok) this.dom.s_ok.innerText = stats.success;
                if (this.dom.s_err) this.dom.s_err.innerText = stats.fail;
            });

            // Re-renderizado de la grilla basado en FILTROS
            EventBus.on('POOL_UPDATED', () => {
                const users = Store.getFilteredPool();
                this.dom.s_scn.innerText = users.length;
                this.dom.s_wl.innerText = Store.whitelist.size;
                
                const frag = document.createDocumentFragment();
                if (this.dom.grd) this.dom.grd.innerHTML = ''; 
                this.observer.disconnect(); 
                
                users.forEach(u => {
                    const isWl = Store.whitelist.has(u.id);
                    const div = document.createElement('div');
                    div.className = `crd ${Store.queue.has(u.id) ? 'sel' : ''} ${isWl ? 'wl' : ''}`;
                    div.dataset.id = u.id;
                    div.title = `@${u.username} \n${u.full_name}\n${u.follows_viewer ? 'SÍ te sigue' : 'NO te sigue'}`; 
                    
                    const star = document.createElement('div');
                    star.className = 'crd-star'; star.innerHTML = '★';
                    div.appendChild(star);

                    const img = document.createElement('img');
                    img.dataset.src = u.profile_pic_url; 
                    div.appendChild(img);

                    if (u.is_private) {
                        const p = document.createElement('span');
                        p.style.cssText = 'position:absolute;bottom:4px;right:4px;font-size:9px;background:var(--err);color:#fff;padding:2px 4px;border-radius:3px;font-weight:800;z-index:2;';
                        p.textContent = 'P'; div.appendChild(p);
                    }
                    if (u.is_verified) {
                        const v = document.createElement('span');
                        v.style.cssText = 'position:absolute;bottom:4px;left:4px;font-size:9px;background:#007aff;color:#fff;padding:2px 4px;border-radius:3px;font-weight:800;z-index:2;';
                        v.textContent = '✓'; div.appendChild(v);
                    }
                    frag.appendChild(div);
                });
                
                if (this.dom.grd) {
                    this.dom.grd.appendChild(frag);
                    this.dom.grd.querySelectorAll('img').forEach(img => this.observer.observe(img));
                }
                if (this.dom.run) this.dom.run.disabled = Store.queue.size === 0 || Store.state.status === "run";
            });

            EventBus.on('QUEUE_TOGGLED', ({ id, selected }) => {
                if (!this.dom.grd) return;
                const card = this.dom.grd.querySelector(`.crd[data-id="${id}"]`);
                if (card) selected ? card.classList.add('sel') : card.classList.remove('sel');
                this.dom.s_sel.innerText = Store.queue.size;
                if (this.dom.run) this.dom.run.disabled = Store.queue.size === 0 || Store.state.status === "run";
            });

            EventBus.on('QUEUE_CLEARED', () => {
                if (!this.dom.grd) return;
                this.dom.grd.querySelectorAll('.crd.sel').forEach(el => el.classList.remove('sel'));
                this.dom.s_sel.innerText = 0;
                if (this.dom.run) this.dom.run.disabled = true;
            });

            EventBus.on('ITEM_PROCESSED', ({ id, result }) => {
                if (!this.dom.grd) return;
                const card = this.dom.grd.querySelector(`.crd[data-id="${id}"]`);
                if (card) { card.classList.remove('sel'); card.classList.add(result); }
                this.dom.s_sel.innerText = Store.queue.size;
            });

            EventBus.on('NEW_LOG', (log) => {
                if (!this.dom.lgs) return;
                this.logsArr.unshift(`<div class="${log.type}" style="margin-bottom:4px;">[${log.t}] ${Utils.sanitize(log.msg)}</div>`);
                if(this.logsArr.length > 80) this.logsArr.pop();
                this.dom.lgs.innerHTML = this.logsArr.join('');
            });

            EventBus.on('PROGRESS_UPDATED', percent => { if (this.dom.prog) this.dom.prog.style.width = `${percent}%`; });
            EventBus.on('TIMER_UPDATED', remainingMs => { if (this.dom.act) this.dom.act.innerText = `NEXT: ${Utils.fmt(remainingMs)}`; });

            EventBus.on('SELF_DESTRUCT', () => {
                const host = document.getElementById(CFG.SYS_ID);
                if(host) {
                    host.style.opacity = '0';
                    host.style.transform = 'scale(0.8) translateY(40px)';
                    setTimeout(() => host.remove(), 500);
                }
            });
        }
    };

    // ==========================================
    // 🚀 BOOT SEQUENCE
    // ==========================================
    (async () => {
        UI.init();
        await Engine.init();
        ErrorHandler.log("⚡ V6.1 GOD MODE ONLINE. Filtros y Whitelist Activos.", "suc");
    })();
})();
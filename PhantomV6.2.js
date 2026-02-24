(() => {
    "use strict";

    // ==========================================
    // 💀 PHANTOM CONFIG (V6.2 GOD MODE + EXTREME STEALTH)
    // ==========================================
    const CFG = {
        HASH_FOLLOWERS: "c76146de99bb02f6415203be841dd25a", 
        HASH_FOLLOWING: "3dec7e2c57367ef3da3d987d89f9dbc8", 
        APP_ID: "936619743392459", 
        TIMINGS: { 
            SCAN_BASE: 1000, 
            ACTION_BASE: 4000,
            BATCH_PAUSE: 300000 // 5 Minutos
        },
        LIMITS: { SESSION: 150, BATCH: 50, MAX_ERRORS: 3, CIRCUIT_BREAK_MS: 900000 },
        FILTERS: { SKIP_VERIFIED: true, SKIP_NO_PIC: true }, 
        NO_PIC_IDS: ["44884218_345707102882519_2446069589734326272_n", "464760996_1254146839119862_3605321457742435801_n"],
        SYS_ID: 'ig_core_' + Math.random().toString(36).substring(2, 12),
        CSRF: document.cookie.match(/csrftoken=([^;]+)/)?.[1] || ""
    };

    // ==========================================
    // 🛡️ UTILS, SECURITY & ADVANCED FATIGUE
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
        
        // Simulación de fatiga humana aleatoria (indetectable)
        getFatigueDelay: (actionsDone, baseDelay) => {
            const fatigueMultiplier = 1 + (actionsDone * 0.04); 
            const jitter = Math.random() * 0.5 + 0.75; // Oscilación caótica 0.75x - 1.25x
            return Math.floor(baseDelay * fatigueMultiplier * jitter);
        }
    };

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
    // 💽 ASYNC INDEXED-DB
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
            const tx = this.db.transaction("processed", "readwrite");
            tx.objectStore("processed").put({ id, timestamp: Date.now() });
        }
    };

    // ==========================================
    // 🧠 REACTIVE STORE
    // ==========================================
    const Store = {
        state: new Proxy({ 
            status: "idle", mode: "follow", target: "", 
            stats: { scanned: 0, success: 0, fail: 0, errs: 0, backoff: 30000 },
        }, {
            set(t, p, v) { t[p] = v; EventBus.emit(`STATE_CHANGED_${p.toUpperCase()}`, v); return true; }
        }),
        pool: new Map(), queue: new Set(),
        
        addPool(users) {
            users.forEach(u => this.pool.set(u.id, u));
            EventBus.emit('POOL_UPDATED', Array.from(this.pool.values()));
        },
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
                await fetch('/', { credentials: 'include' });
                CFG.CSRF = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || CFG.CSRF;
                ErrorHandler.log("✅ Sesión restaurada y blindada.", "suc");
                return true;
            } catch (e) { return false; }
        },

        async req(url, method = "GET") {
            if (Date.now() < this.circuitOpenUntil) throw new Error("Cortocircuito Activo.");

            const opt = { method, credentials: "include", signal: this.controller.signal };
            if (method === "POST") { opt.headers = this.headers; opt.body = ""; } 
            else opt.headers = this.headers;
            
            let res = await fetch(url, opt);
            
            if (res.status === 403) {
                if (await this.healSession()) {
                    opt.headers = this.headers;
                    res = await fetch(url, opt);
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
                if(r.err === "LIMIT" && r.retry > 600000) {
                    this.circuitOpenUntil = Date.now() + CFG.LIMITS.CIRCUIT_BREAK_MS;
                    throw new Error(`Circuit Breaker: Ban detectado. Bloqueo 15 min.`);
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
                ErrorHandler.log("💽 Motor de base de datos cargado.", "suc");
            } catch (e) { ErrorHandler.handle(e, "Arranque DB"); }
        },

        selfDestruct() {
            Store.state.status = "dead";
            Net.abort();
            EventBus.emit('SELF_DESTRUCT');
        },

        async runScan() {
            if (!Store.state.target) return ErrorHandler.log("❌ Sin objetivo.", "err");
            Store.state.status = "scan";
            Net.resetController();
            ErrorHandler.log(`🔍 Escaneando V6.2 MODO OCULTO: @${Store.state.target}...`);
            
            try {
                const id = await Net.resolve(Store.state.target);
                if (!id) throw new Error("Objetivo no encontrado.");

                let cur = null, next = true, cycles = 0;
                Store.pool.clear(); Store.clearQueue();
                
                while (next && Store.state.status === "scan") {
                    const d = await Net.scan(id, cur, Store.state.mode);
                    if (d?.err) throw new Error("Rate Limit en escaner.");
                    
                    const edge = Store.state.mode === "unfollow" ? d?.data?.user?.edge_follow : d?.data?.user?.edge_followed_by;
                    if (!edge) throw new Error("API modificada por IG.");

                    next = edge.page_info.has_next_page;
                    cur = edge.page_info.end_cursor;
                    
                    const valid = [];
                    for (const e of edge.edges) {
                        const u = e.node;
                        if (Store.state.mode === "follow" && (u.followed_by_viewer || u.requested_by_viewer)) continue;
                        if (CFG.FILTERS.SKIP_VERIFIED && u.is_verified) continue;
                        if (CFG.FILTERS.SKIP_NO_PIC && (u.profile_pic_url.includes("anonymous") || CFG.NO_PIC_IDS.some(pid => u.profile_pic_url.includes(pid)))) continue;
                        
                        if (!(await DB.has(u.id))) valid.push(u);
                    }

                    Store.addPool(valid);
                    Store.state.stats = { ...Store.state.stats, scanned: Store.pool.size }; 

                    if (++cycles > 6) {
                        cycles = 0;
                        await Utils.sleep(Math.random() * 5000 + 4000); 
                    } else {
                        await Utils.sleep(Utils.getFatigueDelay(0, CFG.TIMINGS.SCAN_BASE));
                    }
                }
                ErrorHandler.log(`✅ Escaneo seguro listo: ${Store.pool.size} perfiles.`, "suc");
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
                        ErrorHandler.log("🛑 Cuota segura de sesión alcanzada.", "wait"); break;
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
                        ErrorHandler.log(`${Store.state.mode==="follow"?'➕':'➖'} @${user.username}`, "suc");
                    } else {
                        Store.state.stats = { ...Store.state.stats, fail: Store.state.stats.fail + 1, errs: Store.state.stats.errs + 1 };
                        EventBus.emit('ITEM_PROCESSED', { id: uid, result: 'err' });
                        
                        if (Store.state.stats.errs >= CFG.LIMITS.MAX_ERRORS) return this.selfDestruct();
                        
                        const waitTime = ok.retry || Store.state.stats.backoff;
                        ErrorHandler.log(`⚠️ Escudo activado. Enfriamiento: ${Utils.fmt(waitTime)}.`, "err");
                        await Utils.sleep(waitTime);
                        Store.state.stats.backoff *= 2; 
                    }

                    EventBus.emit('PROGRESS_UPDATED', ((i + 1) / targets.length) * 100);
                    if (i === targets.length - 1 || Store.state.status === "dead") break;

                    let cd = (Store.state.stats.success > 0 && Store.state.stats.success % 5 === 0) 
                        ? CFG.TIMINGS.BATCH_PAUSE + Math.floor(Math.random() * 20000) 
                        : Utils.getFatigueDelay(Store.state.stats.success, CFG.TIMINGS.ACTION_BASE);

                    if (cd > 60000) ErrorHandler.log(`🛑 Lote listo. Micro-sueño táctico: ${Utils.fmt(cd)}`, "wait");

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
                    ErrorHandler.log("🏁 Secuencia Finalizada.", "suc");
                }
            }
        },
        abort() { if (["scan", "run"].includes(Store.state.status)) { Net.abort(); Store.state.status = "idle"; } }
    };

    // ==========================================
    // 🖥️ NANO UI (ZERO-NETWORK-ERRORS DESIGN)
    // ==========================================
    const UI = {
        dom: {}, shadow: null, logsArr: [],
        css: `
            :host { --ac: #00ffcc; --bg: rgba(10, 10, 12, 0.98); --c-bg: rgba(20, 20, 24, 0.9); --txt: #e0e0e0; --mut: #888; --err: #ff4757; --suc: #2ed573; --brd: rgba(0, 255, 204, 0.2); }
            .sys { font-family: system-ui, sans-serif; user-select: none; background: var(--bg); backdrop-filter: blur(20px); border: 1px solid var(--brd); color: var(--txt); width: 480px; height: 720px; border-radius: 12px; box-shadow: 0 30px 60px rgba(0,0,0,0.9); transition: 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); display: flex; flex-direction: column; }
            .sys.min { height: 48px; width: 48px; border-radius: 24px; cursor: pointer; overflow: hidden; border-color: var(--ac); }
            .hd { padding: 14px 20px; background: rgba(0,0,0,0.5); border-bottom: 1px solid var(--brd); display: flex; justify-content: space-between; align-items: center; font-weight: 700; letter-spacing: 0.5px; }
            .bd { flex: 1; display: flex; flex-direction: column; padding: 16px; gap: 12px; overflow: hidden; }
            .inp { background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.05); color: #fff; padding: 12px; width: 100%; box-sizing: border-box; border-radius: 6px; font-size: 13px; outline: none; transition: 0.2s;}
            .inp:focus { border-color: var(--ac); box-shadow: 0 0 10px rgba(0,255,204,0.1); }
            .btn { background: rgba(0,255,204,0.05); color: var(--ac); border: 1px solid var(--brd); padding: 10px; cursor: pointer; font-size: 11px; font-weight: 800; border-radius: 6px; transition: 0.2s; text-transform: uppercase;}
            .btn:hover:not(:disabled) { background: var(--ac); color: #000; box-shadow: 0 0 15px rgba(0,255,204,0.4);}
            .btn:disabled { border-color: #333; color: #555; background: transparent; cursor: not-allowed; }
            
            .grd { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; align-content: start; padding-right: 4px;}
            .crd { width: 100%; display: flex; flex-direction: column; gap: 6px; background: transparent; position: relative; cursor: pointer; opacity: 0.6; transition: 0.2s; box-sizing: border-box; }
            .crd:hover { opacity: 1; transform: translateY(-2px); z-index: 2; }
            
            /* Avatar Tipográfico (Cero Errores de Red) */
            .img-wrap { width: 100%; aspect-ratio: 1; position: relative; border-radius: 8px; overflow: hidden; border: 2px solid transparent; background: linear-gradient(135deg, rgba(30,30,36,1) 0%, rgba(15,15,18,1) 100%); transition: 0.2s; box-shadow: 0 4px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; }
            .avatar-txt { font-size: 26px; font-weight: 900; color: rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 1px; transition: 0.2s;}
            .crd.sel .img-wrap { border-color: var(--ac); box-shadow: 0 0 15px rgba(0,255,204,0.4); }
            .crd.sel .avatar-txt { color: var(--ac); text-shadow: 0 0 10px rgba(0,255,204,0.5); }
            
            .crd.ok { opacity: 0.3; filter: grayscale(100%); pointer-events:none;}
            .crd.err .img-wrap { border-color: var(--err); }
            .crd.err .avatar-txt { color: var(--err); }
            
            .name { font-size: 11px; text-align: center; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
            .badge { position: absolute; bottom: 4px; right: 4px; font-size: 9px; background: rgba(255, 71, 87, 0.9); color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: 900; letter-spacing: 0.5px; box-shadow: 0 2px 5px rgba(0,0,0,0.8); backdrop-filter: blur(2px); border: 1px solid rgba(255,255,255,0.2); z-index: 2; }
            
            .sts { display: flex; justify-content: space-between; font-size: 11px; color: var(--mut); background: rgba(0,0,0,0.4); padding: 10px 14px; border-radius: 6px; font-weight: 600;}
            .lgs { height: 150px; flex-shrink: 0; background: rgba(0,0,0,0.8); border-radius: 6px; font-size: 11px; padding: 12px; overflow-y: auto; color: var(--mut); font-family: monospace; border: 1px solid rgba(255,255,255,0.05);}
            .suc { color: var(--suc); } .err { color: var(--err); } .wait { color: #feca57; } .info { color: #48dbfb; }
            .bar { height: 2px; background: rgba(255,255,255,0.02); width: 100%; }
            .fil { height: 100%; background: var(--ac); width: 0%; transition: width 0.4s ease, box-shadow 0.4s; box-shadow: 0 0 10px var(--ac);}
            ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 10px; }
        `,
        init() {
            // Limpieza oculta de instancias previas
            document.querySelectorAll(`div[data-core="sys"]`).forEach(el => el.remove());
            const host = document.createElement('div');
            host.id = CFG.SYS_ID; host.dataset.core = "sys";
            host.style.cssText = 'position:fixed; bottom:25px; right:25px; z-index:2147483647;';
            document.documentElement.appendChild(host); 

            this.shadow = host.attachShadow({ mode: 'closed' });
            this.shadow.innerHTML = `<style>${this.css}</style>
                <div class="sys" id="main">
                    <div class="hd">
                        <div style="display:flex; align-items:center; gap:8px; color:var(--ac); font-size:14px">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                            GOD MODE V6.2
                        </div>
                        <span id="act" style="font-size:10px; color:#feca57;">IDLE</span>
                        <div style="display:flex; gap:12px;">
                            <span id="b-min" style="cursor:pointer; color:var(--mut); transition:0.2s;">_</span>
                            <span id="b-cls" style="cursor:pointer; color:var(--mut); transition:0.2s;">✕</span>
                        </div>
                    </div>
                    <div class="bar"><div class="fil" id="prog"></div></div>
                    <div class="bd">
                        <div style="display:flex; gap:8px">
                            <input class="inp" id="targ" placeholder="Objetivo (@usuario)" autocomplete="off" spellcheck="false">
                            <button class="btn" id="b-scn" style="width:110px;">ESCANEAR</button>
                        </div>
                        <div class="sts">
                            <span>POOL: <b id="s-scn" style="color:#fff">0</b></span>
                            <span>OK: <b id="s-ok" class="suc">0</b></span>
                            <span>ERR: <b id="s-err" class="err">0</b></span>
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button class="btn" style="flex:1" id="b-mod">M: FOLLOW</button>
                            <button class="btn" style="flex:0.4" id="b-all">ALL</button>
                            <button class="btn" style="flex:0.4" id="b-prv">PRIV</button>
                            <button class="btn" style="flex:0.4" id="b-clr">CLR</button>
                        </div>
                        <div class="grd" id="grd"></div>
                        <div class="lgs" id="lgs"></div>
                        <div style="display:flex; gap:8px; margin-top:auto;">
                            <button class="btn" style="flex:2; padding:14px; font-size:12px;" id="b-run" disabled>INICIAR SECUENCIA</button>
                            <button class="btn" style="flex:1; color:var(--err); border-color:rgba(255,71,87,0.2); background:rgba(255,71,87,0.05);" id="b-stp">ABORTAR</button>
                        </div>
                    </div>
                </div>`;
            
            const $ = s => this.shadow.querySelector(s);
            this.dom = {
                targ: $('#targ'), scn: $('#b-scn'), run: $('#b-run'), stp: $('#b-stp'),
                min: $('#b-min'), cls: $('#b-cls'), grd: $('#grd'), lgs: $('#lgs'),
                s_scn: $('#s-scn'), s_ok: $('#s-ok'), s_err: $('#s-err'), act: $('#act'),
                prog: $('#prog'), mod: $('#b-mod'), all: $('#b-all'), prv: $('#b-prv'),
                clr: $('#b-clr'), main: $('#main')
            };

            this.bindEvents();
            this.bindStoreEvents();
        },

        bindEvents() {
            this.dom.scn.onclick = () => Engine.runScan();
            this.dom.targ.oninput = e => Store.state.target = Utils.sanitize(e.target.value.replace('@', '').trim());
            this.dom.mod.onclick = () => Store.state.mode = Store.state.mode === "follow" ? "unfollow" : "follow";
            this.dom.all.onclick = () => Store.pool.forEach(u => Store.toggleQueue(u.id, true));
            this.dom.prv.onclick = () => Store.pool.forEach(u => u.is_private && Store.toggleQueue(u.id, true));
            this.dom.clr.onclick = () => Store.clearQueue();
            this.dom.run.onclick = () => Engine.engage();
            this.dom.stp.onclick = () => Engine.abort();
            
            this.dom.min.onclick = () => {
                const isMin = this.dom.main.classList.toggle('min');
                this.dom.main.style.height = isMin ? '48px' : '720px';
                this.dom.main.style.width = isMin ? '48px' : '480px';
            };
            this.dom.cls.onclick = () => Engine.selfDestruct();
            
            this.dom.grd.addEventListener('click', e => {
                const c = e.target.closest('.crd');
                if (c && c.dataset.id && !["run", "dead"].includes(Store.state.status)) {
                    Store.toggleQueue(c.dataset.id);
                }
            }, {passive: true});
        },

        bindStoreEvents() {
            EventBus.on('STATE_CHANGED_STATUS', (status) => {
                const busy = ["scan", "run"].includes(status);
                ['scn', 'run', 'targ', 'mod', 'all', 'prv', 'clr'].forEach(k => { if (this.dom[k]) this.dom[k].disabled = busy; });
                if (status === "idle") {
                    if (this.dom.act) this.dom.act.innerText = "READY";
                    if (this.dom.run) this.dom.run.disabled = Store.queue.size === 0;
                }
            });

            EventBus.on('STATE_CHANGED_MODE', mode => { if (this.dom.mod) this.dom.mod.innerText = `M: ${mode.toUpperCase()}`; });
            EventBus.on('STATE_CHANGED_STATS', stats => {
                if (this.dom.s_scn) this.dom.s_scn.innerText = stats.scanned;
                if (this.dom.s_ok) this.dom.s_ok.innerText = stats.success;
                if (this.dom.s_err) this.dom.s_err.innerText = stats.fail;
            });

            EventBus.on('POOL_UPDATED', (users) => {
                const frag = document.createDocumentFragment();
                if (this.dom.grd) this.dom.grd.innerHTML = ''; 
                
                users.forEach(u => {
                    const div = document.createElement('div');
                    div.className = `crd ${Store.queue.has(u.id) ? 'sel' : ''}`;
                    div.dataset.id = u.id;
                    div.title = `@${u.username}`; 
                    
                    const wrap = document.createElement('div');
                    wrap.className = 'img-wrap';
                    
                    // AVATAR LIMPIO - Reemplaza la imagen por las iniciales del usuario
                    const avatarTxt = document.createElement('div');
                    avatarTxt.className = 'avatar-txt';
                    // Extrae 1 o 2 letras del username para el diseño
                    avatarTxt.textContent = u.username.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2);
                    wrap.appendChild(avatarTxt);

                    if (u.is_private) {
                        const badge = document.createElement('div');
                        badge.className = 'badge';
                        badge.innerHTML = '🔒 PRIV';
                        wrap.appendChild(badge);
                    }

                    const name = document.createElement('div');
                    name.className = 'name';
                    name.textContent = u.username;

                    div.appendChild(wrap);
                    div.appendChild(name);
                    frag.appendChild(div);
                });
                
                if (this.dom.grd) {
                    this.dom.grd.appendChild(frag);
                }
            });

            EventBus.on('QUEUE_TOGGLED', ({ id, selected }) => {
                if (!this.dom.grd) return;
                const card = this.dom.grd.querySelector(`.crd[data-id="${id}"]`);
                if (card) selected ? card.classList.add('sel') : card.classList.remove('sel');
                if (this.dom.run) this.dom.run.disabled = Store.queue.size === 0 || Store.state.status === "run";
            });

            EventBus.on('QUEUE_CLEARED', () => {
                if (!this.dom.grd) return;
                this.dom.grd.querySelectorAll('.crd.sel').forEach(el => el.classList.remove('sel'));
                if (this.dom.run) this.dom.run.disabled = true;
            });

            EventBus.on('ITEM_PROCESSED', ({ id, result }) => {
                if (!this.dom.grd) return;
                const card = this.dom.grd.querySelector(`.crd[data-id="${id}"]`);
                if (card) { card.classList.remove('sel'); card.classList.add(result); }
            });

            EventBus.on('NEW_LOG', (log) => {
                if (!this.dom.lgs) return;
                this.logsArr.unshift(`<div class="${log.type}" style="margin-bottom:4px;">[${log.t}] ${Utils.sanitize(log.msg)}</div>`);
                if(this.logsArr.length > 60) this.logsArr.pop();
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
        ErrorHandler.log("⚡ V6.2 GOD MODE ONLINE. Protocolos Stealth Activados.", "suc");
    })();
})();
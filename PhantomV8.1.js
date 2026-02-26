(() => {
    "use strict";

    // ==========================================
    // 💀 PHANTOM CONFIG (V8.1 JUGGERNAUT - ID PURIFIER FIX)
    // ==========================================
    const CFG = {
        HASH_FOLLOWERS: "c76146de99bb02f6415203be841dd25a", 
        HASH_FOLLOWING: "3dec7e2c57367ef3da3d987d89f9dbc8", 
        APP_ID: "936619743392459", 
        TIMINGS: { SCAN_BASE: 1000, ACTION_BASE: 4500, DM_BASE: 8000, BATCH_PAUSE: 300000 },
        LIMITS: { SESSION: 150, DM_SESSION: 40, BATCH: 50, MAX_ERRORS: 3, CIRCUIT_BREAK_MS: 900000 },
        FILTERS: { SKIP_VERIFIED: true, SKIP_NO_PIC: true }, 
        NO_PIC_IDS: ["44884218_345707102882519_2446069589734326272_n", "464760996_1254146839119862_3605321457742435801_n"],
        SYS_ID: 'ig_core_' + Math.random().toString(36).substring(2, 12),
        CSRF: document.cookie.match(/csrftoken=([^;]+)/)?.[1] || "",
        WHITELIST_KEY: 'ig_phantom_whitelist'
    };

    // ==========================================
    // 🛡️ UTILS & SECURITY (SPINTAX & JITTER)
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
        getFatigueDelay: (actionsDone, baseDelay) => Math.floor(baseDelay * (1 + (actionsDone * 0.04)) * (Math.random() * 0.5 + 0.75)),
        getUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        }),
        spinText: (text) => text.replace(/{([^{}]*)}/g, (m, opts) => {
            const arr = opts.split('|');
            return arr[Math.floor(Math.random() * arr.length)];
        })
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
                const req = indexedDB.open("PhantomV8_Core", 1);
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
            status: "idle", mode: "follow", target: "", searchQuery: "", dmMessage: "", keywords: "",
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
    // 🌐 NETWORK LAYER (DIRECT APP API CONNECT)
    // ==========================================
    const Net = {
        controller: new AbortController(), circuitOpenUntil: 0,
        resetController() { this.controller = new AbortController(); }, abort() { this.controller.abort(); },
        get headers() { 
            return { 
                "content-type": "application/x-www-form-urlencoded", 
                "x-csrftoken": document.cookie.match(/csrftoken=([^;]+)/)?.[1] || CFG.CSRF, 
                "x-instagram-ajax": "1", 
                "x-ig-app-id": CFG.APP_ID, 
                "x-requested-with": "XMLHttpRequest" 
            }; 
        },
        async healSession() {
            try { await fetch('/', { credentials: 'include' }); return true; } catch (e) { return false; }
        },
        async req(url, method = "GET", body = "") {
            if (Date.now() < this.circuitOpenUntil) return { err: "LIMIT_SYSTEM" };
            
            const opt = { method, credentials: "include", signal: this.controller.signal, headers: this.headers };
            if (method === "POST") opt.body = body;
            
            let res;
            try { res = await fetch(url, opt); } catch (e) { return { err: "NETWORK" }; }
            
            if (res.status === 403 || res.status === 401) {
                if (await this.healSession()) { opt.headers = this.headers; res = await fetch(url, opt); }
            }
            if (res.status === 429 || res.status === 400 || res.status === 401) {
                const retryAfter = res.headers.get("Retry-After");
                return { err: "LIMIT", retry: retryAfter ? parseInt(retryAfter) * 1000 : 60000 };
            }
            
            const textResponse = await res.text();
            try {
                const data = JSON.parse(textResponse);
                if (data.status === "fail") return { err: "LIMIT", retry: 60000 };
                return data;
            } catch (e) {
                if (textResponse.trim().toLowerCase().startsWith("<!doctype") || textResponse.trim().toLowerCase().startsWith("<html")) {
                    return { err: "LIMIT", retry: 900000 }; 
                }
                return { err: "UNKNOWN" };
            }
        },
        async resolve(username) {
            let r = await this.req(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`);
            if (r?.data?.user?.id) return r.data.user.id;
            r = await this.req(`https://www.instagram.com/web/search/topsearch/?query=${username}`);
            return r?.users?.find(x => x.user.username === username)?.user.pk;
        },
        async scan(id, cursor, mode) {
            const hash = (mode === "infieles") ? CFG.HASH_FOLLOWING : CFG.HASH_FOLLOWERS;
            return this.req(`https://www.instagram.com/graphql/query/?query_hash=${hash}&variables=${encodeURIComponent(JSON.stringify({ id, first: CFG.LIMITS.BATCH, after: cursor }))}`);
        },
        
        async getLatestFeed(uid) {
            const r = await this.req(`https://www.instagram.com/api/v1/feed/user/${uid}/`);
            if (r?.err) return r;
            if (r?.items && r.items.length > 0) return r.items[0]; 
            return null; 
        },
        
        async getLatestStory(uid) {
            const r = await this.req(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${uid}`);
            if (r?.err) return r;
            if (r?.reels && r.reels[uid] && r.reels[uid].items && r.reels[uid].items.length > 0) {
                const items = r.reels[uid].items;
                return items[items.length - 1]; 
            }
            return null; 
        }
    };

    // ==========================================
    // ⚙️ ENGINE LOGIC (THE JUGGERNAUT CORE)
    // ==========================================
    const Engine = {
        async init() { try { await DB.init(); ErrorHandler.log("💽 Motor V8.1 Cargado. ID Fix implementado.", "suc"); } catch (e) { ErrorHandler.handle(e, "Arranque DB"); } },
        selfDestruct() { Store.state.status = "dead"; Net.abort(); EventBus.emit('SELF_DESTRUCT'); },
        
        async runScan() {
            if (!Store.state.target) return ErrorHandler.log("❌ Sin objetivo.", "err");
            Store.state.status = "scan"; Net.resetController(); 
            
            const rawKeywords = Store.state.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
            const includeKeywords = rawKeywords.filter(k => !k.startsWith('!'));
            const excludeKeywords = rawKeywords.filter(k => k.startsWith('!')).map(k => k.substring(1));

            ErrorHandler.log(`🔍 Escaneando en modo ${Store.state.mode.toUpperCase()}: @${Store.state.target}...`);
            try {
                const id = await Net.resolve(Store.state.target);
                if (!id) throw new Error("Objetivo no encontrado.");

                let activeIds = new Set();
                if (Store.state.mode === "infieles") {
                    ErrorHandler.log("🕵️ Analizando interacciones... esto tarda un poco.", "wait");
                    const r = await Net.req(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${Store.state.target}`);
                    const posts = r?.data?.user?.edge_owner_to_timeline_media?.edges?.slice(0, 12) || [];
                    for (const p of posts) {
                        const vars = encodeURIComponent(JSON.stringify({ shortcode: p.node.shortcode, first: 50 }));
                        const likersReq = await Net.req(`https://www.instagram.com/graphql/query/?query_hash=${CFG.HASH_LIKERS}&variables=${vars}`);
                        const likers = likersReq?.data?.shortcode_media?.edge_liked_by?.edges || [];
                        likers.forEach(l => activeIds.add(l.node.id));
                        await Utils.sleep(1500); 
                    }
                    ErrorHandler.log(`🛡️ Fantasmas detectados.`, "suc");
                }

                let cur = null, next = true, cycles = 0; Store.pool.clear(); Store.clearQueue();
                while (next && Store.state.status === "scan") {
                    const d = await Net.scan(id, cur, Store.state.mode);
                    
                    if (d?.err) {
                        if (d.err === "LIMIT" || d.err === "LIMIT_SYSTEM") throw new Error("Límite de IG (Bloqueo temporal). Espera unos minutos.");
                        if (d.err === "NETWORK") throw new Error("Error de red.");
                        throw new Error("Error desconocido o cuenta privada.");
                    }
                    
                    const edge = (Store.state.mode === "infieles") ? d?.data?.user?.edge_follow : d?.data?.user?.edge_followed_by;
                    if (!edge) throw new Error("No se pudo extraer lista (Privada o Protegida).");
                    
                    next = edge.page_info.has_next_page; cur = edge.page_info.end_cursor;
                    const valid = [];
                    
                    for (const e of edge.edges) {
                        const u = e.node;
                        if (Store.whitelist.has(u.username) && Store.state.mode !== "message") continue;
                        if (Store.state.mode === "follow" && (u.followed_by_viewer || u.requested_by_viewer)) continue;
                        if (Store.state.mode === "infieles" && u.follows_viewer) continue; 
                        
                        if (rawKeywords.length > 0) {
                            const fn = (u.full_name || "").toLowerCase();
                            const un = (u.username || "").toLowerCase();
                            const fullText = fn + " " + un;
                            
                            if (excludeKeywords.some(k => fullText.includes(k))) continue;
                            if (includeKeywords.length > 0 && !includeKeywords.some(k => fullText.includes(k))) continue;
                        }

                        if (CFG.FILTERS.SKIP_VERIFIED && u.is_verified && Store.state.mode !== "message") continue;
                        if (CFG.FILTERS.SKIP_NO_PIC && (u.profile_pic_url.includes("anonymous") || CFG.NO_PIC_IDS.some(pid => u.profile_pic_url.includes(pid)))) continue;
                        if (!(await DB.has(u.id))) valid.push(u);
                    }
                    Store.addPool(valid); Store.state.stats = { ...Store.state.stats, scanned: Store.pool.size }; 
                    if (++cycles > 6) { cycles = 0; await Utils.sleep(Math.random() * 5000 + 4000); } else await Utils.sleep(Utils.getFatigueDelay(0, CFG.TIMINGS.SCAN_BASE));
                }
                ErrorHandler.log(`✅ Escaneo listo: ${Store.pool.size} perfiles.`, "suc");
            } catch (error) { ErrorHandler.handle(error, "Escáner"); } finally { if (Store.state.status === "scan") Store.state.status = "idle"; }
        },
        
        async engage() {
            const targets = Array.from(Store.queue);
            if (!targets.length) return;
            if (Store.state.mode === "message" && !Store.state.dmMessage.trim()) return ErrorHandler.log("❌ Pon un mensaje.", "err");

            Store.state.status = "run"; Store.state.stats.backoff = 30000; Net.resetController();
            
            const sessionLimit = Store.state.mode === "message" ? CFG.LIMITS.DM_SESSION : CFG.LIMITS.SESSION;
            const baseTiming = Store.state.mode === "message" ? CFG.TIMINGS.DM_BASE : CFG.TIMINGS.ACTION_BASE;

            ErrorHandler.log(`🚀 Ejecutando táctica: ${Store.state.mode.toUpperCase()}`, "info");

            try {
                for (let i = 0; i < targets.length; i++) {
                    if (Store.state.status !== "run") break;
                    while (document.hidden && Store.state.status === "run") await Utils.sleep(3000); 
                    
                    if (Store.state.stats.success >= sessionLimit) { 
                        ErrorHandler.log(`🛑 Límite de seguridad alcanzado (${sessionLimit}).`, "wait"); 
                        break; 
                    }
                    
                    const uid = targets[i], user = Store.pool.get(uid);
                    let ok = false;
                    let actionIcon = "✔️";

                    // ========================================================
                    // 🚀 NUEVO MOTOR MULTI-ACCIÓN BLINDADO V8.1
                    // ========================================================
                    
                    // 📸 1. MODO FEED LIKE
                    if (Store.state.mode === "boost_feed") {
                        const media = await Net.getLatestFeed(uid);
                        
                        if (media && media.err) { 
                            ok = media; 
                        } else if (!media) { 
                            ok = true; actionIcon = "⏭️ (Sin fotos)"; 
                        } else if (media.has_liked) { 
                            ok = true; actionIcon = "💖 (Foto ya likeada)"; 
                        } else {
                            // 🔥 FIX CRÍTICO: Amputar ID largo (IDfoto_IDusuario) y quedarse solo con ID puro. 
                            // Esto evita el Error 400 de IG que salta en algunas cuentas.
                            const pureMediaId = media.pk || (media.id ? media.id.split('_')[0] : null); 
                            
                            if (!pureMediaId) {
                                ok = true; actionIcon = "⚠️ (ID Roto, saltando)";
                            } else {
                                const r = await Net.req(`https://www.instagram.com/api/v1/web/likes/${pureMediaId}/like/`, "POST");
                                if (r && r.status === "ok") { ok = true; actionIcon = "❤️"; } else { ok = r || {err: "UNKNOWN"}; }
                            }
                        }
                    } 
                    // 🎥 2. MODO STORY LIKE 
                    else if (Store.state.mode === "boost_story") {
                        const story = await Net.getLatestStory(uid);
                        
                        if (story && story.err) { 
                            ok = story; 
                        } else if (!story) {
                            ok = true; actionIcon = "⏭️ (Sin historias hoy)";
                        } else if (story.has_liked) {
                            ok = true; actionIcon = "💖 (Historia ya likeada)";
                        } else {
                            // 🔥 FIX CRÍTICO STORY ID
                            const pureStoryId = story.pk || (story.id ? story.id.split('_')[0] : null);
                            
                            if(!pureStoryId) {
                                ok = true; actionIcon = "⚠️ (ID Roto, saltando)";
                            } else {
                                const r = await Net.req(`https://www.instagram.com/api/v1/story_interactions/send_story_like/`, "POST", `media_id=${pureStoryId}`);
                                if (r && r.status === "ok") { ok = true; actionIcon = "🔥 (Story Like)"; } else { ok = r || {err: "UNKNOWN"}; }
                            }
                        }
                    }
                    // ✉️ 3. MODO MD
                    else if (Store.state.mode === "message") {
                        let msgToSend = Store.state.dmMessage.replace(/@usuario/gi, user.username);
                        const spintaxMessage = Utils.spinText(msgToSend);
                        const body = `recipient_users=[[${uid}]]&action=send_item&is_shh_mode=0&send_attribution=direct_thread&client_context=${Utils.getUUID()}&text=${encodeURIComponent(spintaxMessage)}`;
                        const r = await Net.req(`https://www.instagram.com/api/v1/direct_v2/threads/broadcast/text/`, "POST", body);
                        if (r && r.err) ok = r; else { ok = (r && r.status === "ok"); actionIcon = "✉️"; }
                    } 
                    // ➕💔 4. MODO FOLLOW/UNFOLLOW
                    else {
                        const actionEndpoint = Store.state.mode === "infieles" ? "unfollow" : "follow";
                        const r = await Net.req(`https://www.instagram.com/web/friendships/${uid}/${actionEndpoint}/`, "POST");
                        if (r && r.err) ok = r; else { ok = (r && ["ok", "following", "unfollowed"].includes(r.status || r.result)); actionIcon = actionEndpoint === "follow" ? "➕" : "💔"; }
                    }
                    // ========================================================
                    
                    if (ok === true) {
                        Store.state.stats.errs = 0; Store.state.stats.backoff = 30000; Store.toggleQueue(uid, false); Store.state.stats.success++; 
                        DB.save(uid); 
                        EventBus.emit('ITEM_PROCESSED', { id: uid, result: 'ok' }); 
                        ErrorHandler.log(`${actionIcon} @${user.username}`, "suc");
                    } else {
                        Store.state.stats = { ...Store.state.stats, fail: Store.state.stats.fail + 1, errs: Store.state.stats.errs + 1 };
                        EventBus.emit('ITEM_PROCESSED', { id: uid, result: 'err' });
                        if (Store.state.stats.errs >= CFG.LIMITS.MAX_ERRORS) return this.selfDestruct();
                        const waitTime = ok.retry || Store.state.stats.backoff;
                        ErrorHandler.log(`⚠️ Escudo activado. Límite de Acción detectado (Error 400). Pausa: ${Utils.fmt(waitTime)}.`, "err");
                        await Utils.sleep(waitTime); Store.state.stats.backoff *= 2; 
                    }
                    
                    EventBus.emit('PROGRESS_UPDATED', ((i + 1) / targets.length) * 100);
                    if (i === targets.length - 1 || Store.state.status === "dead") break;

                    let cd = (Store.state.stats.success > 0 && Store.state.stats.success % 5 === 0) ? CFG.TIMINGS.BATCH_PAUSE + Math.floor(Math.random() * 20000) : Utils.getFatigueDelay(Store.state.stats.success, baseTiming);
                    if (cd > 60000) ErrorHandler.log(`🛑 Lote listo. Micro-sueño táctico: ${Utils.fmt(cd)}`, "wait");
                    let elapsed = 0;
                    while (elapsed < cd && Store.state.status === "run") { await Utils.sleep(1000); elapsed += 1000; EventBus.emit('TIMER_UPDATED', cd - Math.min(elapsed, cd)); }
                }
            } catch (error) { ErrorHandler.handle(error, "Motor"); } finally { if (Store.state.status !== "dead") { Store.state.status = "idle"; ErrorHandler.log("🏁 Secuencia Finalizada.", "suc"); } }
        },
        abort() { if (["scan", "run"].includes(Store.state.status)) { Net.abort(); Store.state.status = "idle"; } }
    };

    // ==========================================
    // 🖥️ NANO UI
    // ==========================================
    const UI = {
        dom: {}, shadow: null, logsArr: [],
        css: `:host{--ac:#0fe;--bg:rgba(10,10,14,.95);--txt:#e2e8f0;--mut:#64748b;--err:#f43f5e;--suc:#10b981;--wait:#fbbf24;--brd:rgba(0,255,238,.15)}.sys{font-family:system-ui,sans-serif;user-select:none;background:var(--bg);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid var(--brd);color:var(--txt);width:440px;height:740px;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.9),inset 0 0 20px rgba(0,255,238,.05);transition:.4s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;overflow:hidden}.sys.min{height:48px !important;width:48px !important;border-radius:24px;border-color:var(--ac);box-shadow:0 0 20px rgba(0,255,238,.2)}.sys.max{width:90vw !important;height:90vh !important}.hd{padding:16px 20px;background:rgba(0,0,0,.4);border-bottom:1px solid var(--brd);display:flex;justify-content:space-between;align-items:center;font-weight:700;letter-spacing:1px}.bd{flex:1;display:flex;flex-direction:column;padding:16px;gap:10px;overflow:hidden}.inp{background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.08);color:#fff;padding:10px 14px;width:100%;box-sizing:border-box;border-radius:8px;font-size:13px;outline:0;transition:.3s;box-shadow:inset 0 2px 4px rgba(0,0,0,.5)}.inp:focus{border-color:var(--ac);box-shadow:0 0 12px rgba(0,255,238,.15),inset 0 2px 4px rgba(0,0,0,.5)}.btn{background:rgba(0,255,238,.05);color:var(--ac);border:1px solid var(--brd);padding:10px;cursor:pointer;font-size:11px;font-weight:800;border-radius:8px;transition:.3s;text-transform:uppercase;letter-spacing:.5px}.btn:hover:not(:disabled){background:var(--ac);color:#000;box-shadow:0 0 15px rgba(0,255,238,.4),0 0 5px var(--ac)}.btn:disabled{border-color:rgba(255,255,255,.05);color:var(--mut);background:0 0;cursor:not-allowed;box-shadow:none}.grd{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:16px 8px;align-content:start;padding:8px 4px}.crd{display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;opacity:.5;transition:.2s;animation:fade-in .3s ease-out}.crd:hover{opacity:1;transform:translateY(-3px)}.img-wrap{width:64px;height:64px;flex-shrink:0;border-radius:50%;background:linear-gradient(135deg,#1e1e24,#0a0a0c);border:2px solid rgba(255,255,255,.05);box-shadow:0 4px 10px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;position:relative;transition:.3s}.avatar-txt{font-size:20px;font-weight:900;color:rgba(255,255,255,.2);text-transform:uppercase;letter-spacing:1px;transition:.3s}.crd.sel{opacity:1}.crd.sel .img-wrap{border-color:var(--ac);box-shadow:0 0 20px rgba(0,255,238,.3),inset 0 0 10px rgba(0,255,238,.1)}.crd.sel .avatar-txt{color:var(--ac);text-shadow:0 0 12px rgba(0,255,238,.6)}.crd.ok{opacity:.2;filter:grayscale(1);pointer-events:none}.crd.err .img-wrap{border-color:var(--err);box-shadow:0 0 15px rgba(244,63,94,.2)}.crd.err .avatar-txt{color:var(--err);text-shadow:0 0 10px rgba(244,63,94,.5)}.name{width:100%;max-width:84px;font-size:11px;font-weight:600;text-align:center;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.badge{position:absolute;bottom:-4px;right:-4px;background:#111;color:#fff;font-size:10px;padding:3px;border-radius:50%;border:1.5px solid var(--err);box-shadow:0 2px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;line-height:1;width:14px;height:14px}.sts{display:flex;justify-content:space-between;font-size:11px;color:var(--mut);background:rgba(0,0,0,.3);padding:10px 14px;border-radius:8px;font-weight:700;border:1px solid rgba(255,255,255,.03)}.lgs{height:95px;flex-shrink:0;background:rgba(0,0,0,.6);border-radius:8px;font-size:11px;padding:12px;overflow-y:auto;color:var(--mut);font-family:'Courier New',monospace;border:1px solid rgba(255,255,255,.05);box-shadow:inset 0 4px 10px rgba(0,0,0,.5)}.suc{color:var(--suc)}.err{color:var(--err)}.wait{color:var(--wait)}.info{color:#38bdf8}.bar{height:2px;background:rgba(255,255,255,.05);width:100%}.fil{height:100%;background:var(--ac);width:0%;transition:width .4s cubic-bezier(.4,0,.2,1);box-shadow:0 0 12px var(--ac)}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:10px}::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.3)}@keyframes fade-in{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}`,
        init() {
            document.querySelectorAll(`div[data-core="sys"]`).forEach(el => el.remove());
            const host = document.createElement('div');
            host.id = CFG.SYS_ID; host.dataset.core = "sys";
            host.style.cssText = 'position:fixed;bottom:25px;right:25px;z-index:2147483647;';
            document.documentElement.appendChild(host); 
            this.shadow = host.attachShadow({ mode: 'closed' });
            
            this.shadow.innerHTML = `<style>${this.css}</style>
            <div class="sys" id="main">
                <div class="hd">
                    <div style="display:flex;align-items:center;gap:8px;color:var(--ac);font-size:14px">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>Phantom V8.1 (ID Fix)
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
                    <div style="display:flex;gap:8px">
                        <input class="inp" id="kwd" placeholder="Filtro Láser (ej: bcn, !rrpp)" autocomplete="off" spellcheck="false" style="border: 1px solid rgba(254,202,87,0.4);">
                    </div>
                    <div class="sts">
                        <span>POOL: <b id="s-scn" style="color:#fff">0</b></span>
                        <span>OK: <b id="s-ok" class="suc">0</b></span>
                        <span>ERR: <b id="s-err" class="err">0</b></span>
                    </div>
                    <div style="display:flex;gap:6px">
                        <button class="btn" style="flex:1; cursor:pointer; border-color:var(--brd);" id="b-mod" title="Click para cambiar modo">M: FOLLOW</button>
                        <button class="btn" style="flex:.4" id="b-all" title="Marcar Todos">ALL</button>
                        <button class="btn" style="flex:.4" id="b-prv" title="Marcar Privadas">PRIV</button>
                        <button class="btn" style="flex:.4" id="b-pub" title="Marcar Públicas">PUB</button>
                        <button class="btn" style="flex:.4" id="b-clr" title="Limpiar Marcas">CLR</button>
                    </div>
                    <div style="display:flex;gap:6px">
                        <button class="btn" style="flex:1; color:#feca57; border-color:rgba(254,202,87,0.2); background:rgba(254,202,87,0.05);" id="b-wht" title="Añadir a la Whitelist">⭐ PROTEGER</button>
                        <button class="btn" style="flex:.8; color:#ff4757; border-color:rgba(255,71,87,0.2); background:rgba(255,71,87,0.05);" id="b-cwht" title="Vaciar la Whitelist">🗑️ VACIAR (<span id="wht-cnt">0</span>)</button>
                    </div>
                    <textarea class="inp" id="dm-msg" placeholder="Hook Spintax: {Ey|Hola|Buenas} @usuario, ¿sales este finde? {Hablame y te paso lista|Tengo VIP} 🚀" style="display:none; resize:none; height:50px; font-family:inherit;"></textarea>
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
                dm_msg: $('#dm-msg'), kwd: $('#kwd'), main: $('#main') 
            };
            this.bindEvents(); 
            this.bindStoreEvents();
            
            EventBus.emit('WHITELIST_UPDATED', Store.whitelist.size);
        },
        bindEvents() {
            this.dom.scn.onclick = () => Engine.runScan();
            this.dom.targ.oninput = e => Store.state.target = Utils.sanitize(e.target.value.replace('@', '').trim());
            this.dom.kwd.oninput = e => Store.state.keywords = e.target.value;
            this.dom.dm_msg.oninput = e => Store.state.dmMessage = e.target.value;

            this.dom.search_grid.oninput = (e) => {
                Store.state.searchQuery = e.target.value.toLowerCase().trim();
                EventBus.emit('POOL_UPDATED', Array.from(Store.pool.values()));
            };
            
            this.dom.mod.onclick = () => { 
                const modes = ["follow", "infieles", "message", "boost_feed", "boost_story"];
                const nextMode = modes[(modes.indexOf(Store.state.mode) + 1) % modes.length];
                Store.state.mode = nextMode;
                
                this.dom.dm_msg.style.display = nextMode === "message" ? "block" : "none";
                
                if (nextMode === "boost_feed") this.dom.mod.innerText = "M: LIKE FEED 📸";
                else if (nextMode === "boost_story") this.dom.mod.innerText = "M: LIKE STORY 🔥";
                else if (nextMode === "infieles") this.dom.mod.innerText = "M: INFIELES 💔";
                else if (nextMode === "message") this.dom.mod.innerText = "M: MESSAGE (DM) ✉️";
                else this.dom.mod.innerText = "M: FOLLOW ➕";
            };
            
            this.dom.all.onclick = () => Store.pool.forEach(u => Store.toggleQueue(u.id, true));
            this.dom.prv.onclick = () => Store.pool.forEach(u => u.is_private && Store.toggleQueue(u.id, true));
            this.dom.pub.onclick = () => Store.pool.forEach(u => !u.is_private && Store.toggleQueue(u.id, true));
            this.dom.clr.onclick = () => Store.clearQueue();
            
            this.dom.wht.onclick = () => {
                const selectedIds = Array.from(Store.queue);
                if (selectedIds.length === 0) return ErrorHandler.log("⚠️ Selecciona perfiles primero.", "wait");
                const usernames = selectedIds.map(id => Store.pool.get(id).username);
                Store.addWhitelist(usernames);
                selectedIds.forEach(id => Store.pool.delete(id));
                Store.clearQueue();
                EventBus.emit('POOL_UPDATED', Array.from(Store.pool.values()));
                ErrorHandler.log(`⭐ ${usernames.length} perfiles protegidos.`, "suc");
            };

            this.dom.cwht.onclick = () => {
                if (confirm("¿Vaciar Whitelist? Todos dejarán de estar protegidos.")) {
                    Store.clearWhitelist();
                    ErrorHandler.log("🗑️ Lista Blanca vaciada.", "info");
                }
            };

            this.dom.run.onclick = () => Engine.engage();
            this.dom.stp.onclick = () => Engine.abort();
            
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
                ['scn', 'run', 'targ', 'mod', 'all', 'prv', 'pub', 'clr', 'wht', 'cwht', 'search_grid', 'dm_msg', 'kwd'].forEach(k => { if (this.dom[k]) this.dom[k].disabled = busy; });
                if (status === "idle") { 
                    if (this.dom.act) this.dom.act.innerText = "READY"; 
                    if (this.dom.run) this.dom.run.disabled = Store.queue.size === 0; 
                }
            });
            EventBus.on('STATE_CHANGED_MODE', mode => { 
                if (this.dom.run) this.dom.run.disabled = Store.queue.size === 0;
            });
            EventBus.on('STATE_CHANGED_STATS', stats => { if (this.dom.s_scn) this.dom.s_scn.innerText = stats.scanned; if (this.dom.s_ok) this.dom.s_ok.innerText = stats.success; if (this.dom.s_err) this.dom.s_err.innerText = stats.fail; });
            EventBus.on('WHITELIST_UPDATED', size => { if (this.dom.wht_cnt) this.dom.wht_cnt.innerText = size; });

            EventBus.on('POOL_UPDATED', (users) => {
                const frag = document.createDocumentFragment(); if (this.dom.grd) this.dom.grd.innerHTML = ''; 
                const query = Store.state.searchQuery;
                const filteredUsers = query ? users.filter(u => u.username.toLowerCase().includes(query)) : users;

                filteredUsers.forEach(u => {
                    const div = document.createElement('div'); div.className = `crd ${Store.queue.has(u.id) ? 'sel' : ''}`; div.dataset.id = u.id; div.title = `@${u.username}`; 
                    const wrap = document.createElement('div'); wrap.className = 'img-wrap';
                    const avatarTxt = document.createElement('div'); avatarTxt.className = 'avatar-txt'; 
                    avatarTxt.textContent = u.username.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || 'IG';
                    wrap.appendChild(avatarTxt);
                    if (u.is_private) { const badge = document.createElement('div'); badge.className = 'badge'; badge.innerHTML = '🔒'; wrap.appendChild(badge); }
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
            EventBus.on('ITEM_PROCESSED', ({ id, result }) => { 
                if (!this.dom.grd) return; 
                const card = this.dom.grd.querySelector(`.crd[data-id="${id}"]`); 
                if (card) { card.classList.remove('sel'); card.classList.add(result); } 
            });
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
    (async () => { UI.init(); await Engine.init(); ErrorHandler.log("⚡Phantom V8.1 Juggernaut. ID Fix Activo.", "suc"); })();
})();
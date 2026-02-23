(() => {
    "use strict";

    // ==========================================
    // 💀 PHANTOM CONFIG (ENGINEERING CORE)
    // ==========================================
    const CFG = {
        HASH: "c76146de99bb02f6415203be841dd25a",
        WAVE: { MEAN: 45, DEV: 15 }, // Ritmo cardíaco (segundos)
        LIMITS: { SESSION: 50, BATCH: 50 },
        FILTERS: { SKIP_VERIFIED: true, SKIP_NO_PIC: true }, // Inteligencia heurística
        KEYS: { STORE: "ghost_v3_mem" }
    };

    // ==========================================
    // 🧬 BIO-ALGORITHMS (HUMANIZATION)
    // ==========================================
    const Bio = {
        // Distribución Box-Muller para tiempos orgánicos
        pulse: () => {
            let u = 0, v = 0;
            while(u === 0) u = Math.random();
            while(v === 0) v = Math.random();
            let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
            let val = z * CFG.WAVE.DEV + CFG.WAVE.MEAN;
            // Fatiga: Añade 1s extra por cada 10 acciones realizadas para simular cansancio
            const fatigue = Math.floor(Store.state.stats.success / 10) * 1000;
            return Math.max(12000, (val * 1000) + fatigue); 
        },
        sleep: (ms) => new Promise(r => setTimeout(r, ms)),
        fmt: (ms) => ms > 60000 ? `${Math.ceil(ms/60000)}m` : `${Math.ceil(ms/1000)}s`
    };

    // ==========================================
    // 🧠 NEURAL STORE (STATE MANAGEMENT)
    // ==========================================
    const Store = {
        state: {
            status: "idle", // idle, scan, run, sleep
            target: "",
            pool: [],      // Usuarios crudos
            queue: new Set(), // Selección
            stats: { scanned: 0, success: 0, fail: 0 },
            logs: [],
            progress: 0
        },
        mem: JSON.parse(localStorage.getItem(CFG.KEYS.STORE) || '[]'),
        
        save(id) {
            this.mem.push(id);
            if(this.mem.length > 3000) this.mem.shift(); // Memoria circular
            localStorage.setItem(CFG.KEYS.STORE, JSON.stringify(this.mem));
        },
        has(id) { return this.mem.includes(id); }
    };

    // ==========================================
    // 📡 SILENT NETWORK LAYER
    // ==========================================
    const Net = {
        headers: {
            "x-csrftoken": document.cookie.match(/csrftoken=([^;]+)/)?.[1],
            "x-instagram-ajax": "1",
            "x-requested-with": "XMLHttpRequest"
        },
        async req(url, method = "GET") {
            try {
                const res = await fetch(url, { method, headers: method === "POST" ? this.headers : undefined });
                if(res.status === 429 || res.status === 403) return { err: "LIMIT" };
                return await res.json();
            } catch(e) { return { err: "NET" }; }
        },
        async resolve(user) {
            const r = await this.req(`https://www.instagram.com/web/search/topsearch/?query=${user}`);
            return r.users?.find(u => u.user.username === user)?.user.pk;
        },
        async scan(id, cursor) {
            const v = JSON.stringify({ id, first: CFG.LIMITS.BATCH, after: cursor });
            return await this.req(`https://www.instagram.com/graphql/query/?query_hash=${CFG.HASH}&variables=${encodeURIComponent(v)}`);
        },
        async follow(id) {
            const r = await this.req(`https://www.instagram.com/web/friendships/${id}/follow/`, "POST");
            return r.status === "ok" || r.result === "following";
        }
    };

    // ==========================================
    // ⚙️ ENGINE LOGIC
    // ==========================================
    const Engine = {
        log(msg, type="info") {
            const t = new Date().toLocaleTimeString().split(" ")[0];
            Store.state.logs.unshift({t, msg, type});
            if(Store.state.logs.length > 50) Store.state.logs.pop();
            UI.updLogs();
        },
        
        async runScan() {
            if(!Store.state.target) return alert("❌ Sin objetivo");
            UI.setBusy(true);
            this.log(`🔍 Analizando ${Store.state.target}...`);
            
            const id = await Net.resolve(Store.state.target);
            if(!id) { UI.setBusy(false); return this.log("❌ Usuario no encontrado", "err"); }

            let cur = null, next = true, count = 0;
            Store.state.pool = [];
            
            while(next && Store.state.status === "scan") {
                const d = await Net.scan(id, cur);
                if(d.err) break;
                
                const edge = d.data.user.edge_followed_by;
                next = edge.page_info.has_next_page;
                cur = edge.page_info.end_cursor;
                
                const valid = edge.edges.map(e => e.node).filter(u => {
                    // 🛡️ FILTROS HEURÍSTICOS
                    if(u.followed_by_viewer || u.requested_by_viewer) return false;
                    if(Store.has(u.id)) return false;
                    if(CFG.FILTERS.SKIP_VERIFIED && u.is_verified) return false;
                    if(CFG.FILTERS.SKIP_NO_PIC && u.profile_pic_url.includes("anonymous")) return false;
                    return true;
                });

                Store.state.pool.push(...valid);
                count += edge.edges.length;
                UI.dom.stat_scan.innerText = count;
                await Bio.sleep(Math.random() * 1000 + 500); // Micro-pausa
            }
            
            UI.setBusy(false);
            UI.renderGrid();
            this.log(`✅ Escaneo: ${Store.state.pool.length} candidatos`, "suc");
        },

        async engage() {
            const targets = Array.from(Store.state.queue);
            if(!targets.length) return;
            
            Store.state.status = "run";
            UI.setBusy(true);
            
            for(let i=0; i<targets.length; i++) {
                if(Store.state.status !== "run") break;
                
                const uid = targets[i];
                const user = Store.state.pool.find(u => u.id === uid);
                const wait = Bio.pulse();
                
                // Countdown UI
                let cd = wait;
                this.log(`⏳ Esperando ${Bio.fmt(cd)}...`, "wait");
                const timer = setInterval(() => { cd -= 1000; UI.dom.action.innerText = `Próximo: ${Bio.fmt(cd)}`; }, 1000);
                
                await Bio.sleep(wait);
                clearInterval(timer);

                const ok = await Net.follow(uid);
                if(ok === true) {
                    this.log(`👤 Seguido: ${user.username}`, "suc");
                    Store.save(uid);
                    Store.state.stats.success++;
                    Store.state.queue.delete(uid); // Auto-limpiar cola
                } else if(ok?.err === "LIMIT") {
                    this.log("🚨 DETECTADO. Pausa de emergencia (10m).", "err");
                    await Bio.sleep(600000);
                } else {
                    this.log(`❌ Error: ${user.username}`, "err");
                    Store.state.stats.fail++;
                }

                UI.updStats();
                UI.renderGrid(); // Refrescar para quitar el seguido
                UI.dom.prog.style.width = `${((i+1)/targets.length)*100}%`;
            }
            
            Store.state.status = "idle";
            UI.setBusy(false);
            this.log("🏁 Ciclo finalizado.");
        }
    };

    // ==========================================
    // 🖥️ NANO UI (INTERFACE) - CSP COMPLIANT
    // ==========================================
    const UI = {
        dom: {},
        css: `
            #ghost-root { position: fixed; bottom: 20px; right: 20px; z-index: 99999; font-family: monospace; user-select: none; }
            .g-box { background: #000; border: 1px solid #333; color: #0f0; width: 320px; border-radius: 4px; box-shadow: 0 10px 30px rgba(0,255,0,0.1); transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); overflow: hidden; height: 450px; display: flex; flex-direction: column; }
            .g-min { height: 30px; width: 30px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; overflow:hidden; }
            .g-head { padding: 8px; background: #111; border-bottom: 1px solid #222; display: flex; justify-content: space-between; align-items: center; cursor: grab; }
            .g-body { flex: 1; display: flex; flex-direction: column; padding: 10px; gap: 8px; overflow: hidden; }
            .g-input { background: #111; border: 1px solid #333; color: #fff; padding: 6px; width: 100%; box-sizing: border-box; font-family: monospace; }
            .g-btn { background: #111; color: #0f0; border: 1px solid #0f0; padding: 5px; cursor: pointer; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; transition: 0.2s; }
            .g-btn:hover { background: #0f0; color: #000; }
            .g-btn:disabled { border-color: #555; color: #555; cursor: not-allowed; }
            .g-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; align-content: start; border: 1px solid #222; padding: 4px; }
            .g-card { aspect-ratio: 1; background: #111; position: relative; cursor: pointer; border: 1px solid transparent; opacity: 0.6; }
            .g-card.sel { border-color: #0f0; opacity: 1; }
            .g-card img { width: 100%; height: 100%; object-fit: cover; }
            .g-logs { height: 80px; background: #0a0a0a; border-top: 1px solid #222; font-size: 9px; padding: 4px; overflow-y: auto; white-space: pre-wrap; color: #888; }
            .suc { color: #0f0; } .err { color: #f00; } .wait { color: #fa0; }
            .g-bar { height: 2px; background: #111; width: 100%; }
            .g-fill { height: 100%; background: #0f0; width: 0%; transition: width 0.3s; }
            /* Scrollbar */
            ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: #333; }
        `,
        init() {
            if(document.getElementById('ghost-root')) document.getElementById('ghost-root').remove();
            const st = document.createElement('style'); st.textContent = this.css; document.head.appendChild(st);
            
            const root = document.createElement('div');
            root.id = 'ghost-root';
            // ⚠️ FIX: Removed all inline onclick attributes for CSP compliance
            root.innerHTML = `
                <div class="g-box" id="g-main">
                    <div class="g-head">
                        <span>👻 PHANTOM v3</span>
                        <span id="g-action" style="font-size:9px; color:#fa0">IDLE</span>
                        <div style="display:flex; gap:5px">
                            <span id="g-btn-min" style="cursor:pointer">_</span>
                            <span id="g-btn-close" style="cursor:pointer">x</span>
                        </div>
                    </div>
                    <div class="g-bar"><div class="g-fill" id="g-prog"></div></div>
                    <div class="g-body">
                        <div style="display:flex; gap:5px">
                            <input class="g-input" id="g-target" placeholder="Objetivo..." autocomplete="off">
                            <button class="g-btn" id="g-scan">Scan</button>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:10px; color:#555">
                            <span>POOL: <b id="g-s-scan" style="color:#fff">0</b></span>
                            <span>OK: <b id="g-s-ok" style="color:#0f0">0</b></span>
                            <span>FAIL: <b id="g-s-fail" style="color:#f00">0</b></span>
                        </div>
                        <div style="display:flex; gap:5px">
                            <button class="g-btn" style="flex:1" id="g-run" disabled>EJECUTAR</button>
                            <button class="g-btn" style="flex:1; border-color:#f00; color:#f00" id="g-stop">STOP</button>
                        </div>
                        <div class="g-grid" id="g-grid"></div>
                        <div class="g-logs" id="g-logs"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(root);
            
            // Binding Elements
            this.dom = {
                target: root.querySelector('#g-target'),
                btnScan: root.querySelector('#g-scan'),
                btnRun: root.querySelector('#g-run'),
                btnStop: root.querySelector('#g-stop'),
                btnMin: root.querySelector('#g-btn-min'),
                btnClose: root.querySelector('#g-btn-close'),
                grid: root.querySelector('#g-grid'),
                logs: root.querySelector('#g-logs'),
                stat_scan: root.querySelector('#g-s-scan'),
                stat_ok: root.querySelector('#g-s-ok'),
                stat_fail: root.querySelector('#g-s-fail'),
                action: root.querySelector('#g-action'),
                prog: root.querySelector('#g-prog')
            };

            // Event Listeners (Safe JS Binding)
            this.dom.btnScan.onclick = () => { Store.state.status = "scan"; Engine.runScan(); };
            this.dom.target.oninput = (e) => Store.state.target = e.target.value;
            this.dom.btnRun.onclick = () => Engine.engage();
            this.dom.btnStop.onclick = () => { Store.state.status = 'idle'; };
            this.dom.btnMin.onclick = () => document.getElementById('g-main').classList.toggle('g-min');
            this.dom.btnClose.onclick = () => document.getElementById('ghost-root').remove();
            
            // Event Delegation for Grid Items (Avoids inline onclick on cards)
            this.dom.grid.onclick = (e) => {
                const card = e.target.closest('.g-card');
                if (card && card.dataset.id) {
                    UI.toggle(card.dataset.id);
                }
            };
        },
        
        setBusy(busy) {
            this.dom.btnScan.disabled = busy;
            this.dom.btnRun.disabled = busy || Store.state.queue.size === 0;
            this.dom.target.disabled = busy;
            if(!busy) this.dom.action.innerText = "READY";
        },

        renderGrid() {
            // Renderizado virtual
            const html = Store.state.pool.slice(0, 100).map(u => {
                const sel = Store.state.queue.has(u.id);
                // FIX: Removed onclick, added data-id for delegation
                return `<div class="g-card ${sel?'sel':''}" data-id="${u.id}">
                    <img src="${u.profile_pic_url}">
                    ${u.is_private ? '<span style="position:absolute;top:0;right:0;font-size:8px;background:#f00;color:#fff">P</span>':''}
                </div>`;
            }).join('');
            this.dom.grid.innerHTML = html;
            this.dom.btnRun.disabled = Store.state.queue.size === 0 || Store.state.status === "run";
        },

        toggle(id) {
            if(Store.state.status === "run") return;
            if(Store.state.queue.has(id)) Store.state.queue.delete(id);
            else Store.state.queue.add(id);
            this.renderGrid();
        },

        updLogs() {
            this.dom.logs.innerHTML = Store.state.logs.map(l => `<div class="${l.type}">[${l.t}] ${l.msg}</div>`).join('');
            this.dom.logs.scrollTop = this.dom.logs.scrollHeight;
        },
        
        updStats() {
            this.dom.stat_ok.innerText = Store.state.stats.success;
            this.dom.stat_fail.innerText = Store.state.stats.fail;
        }
    };

    // ==========================================
    // 🚀 BOOT
    // ==========================================
    UI.init();
    Engine.log("👻 SYSTEM ONLINE. Silent Mode.", "suc");
})();
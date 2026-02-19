(() => {
    "use strict";
  
    // ============================================
    // CONFIGURACIÓN DE SEGURIDAD (INDETECTABLE)
    // ============================================
    const CONFIG = {
      // Hash para obtener seguidores
      QUERY_HASH: "c76146de99bb02f6415203be841dd25a",
      FOLLOWERS_PER_PAGE: 50,
      // Tiempos humanizados (Lento = Seguro)
      MIN_TIME_BETWEEN_FOLLOWS: 15000, 
      MAX_TIME_BETWEEN_FOLLOWS: 35000,
      LONG_PAUSE_AFTER_COUNT: 10,
      LONG_PAUSE_DURATION: 120000,
      MAX_SESSION_FOLLOWS: 50 
    };
  
    // ============================================
    // ESTADO GLOBAL
    // ============================================
    const state = {
      status: "initial", 
      targetUsername: "", // Usuario objetivo
      targetId: null,
      results: [],
      selected: [],
      logs: [],
      progress: 0,
      searchTerm: "",
      stats: { scanned: 0, total: 0 },
      eta: 0
    };
  
    // ============================================
    // UTILIDADES
    // ============================================
    function getCookie(name) {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop().split(";").shift();
      return null;
    }
  
    function getHumanDelay() {
      return Math.floor(Math.random() * (CONFIG.MAX_TIME_BETWEEN_FOLLOWS - CONFIG.MIN_TIME_BETWEEN_FOLLOWS + 1) + CONFIG.MIN_TIME_BETWEEN_FOLLOWS);
    }
  
    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  
    // Obtener ID numérico a partir del nombre de usuario
    async function resolveUserId(username) {
      try {
        const timestamp = new Date().getTime();
        const url = `https://www.instagram.com/web/search/topsearch/?context=blended&query=${username}&rank_token=0.6&include_reel=true&_=${timestamp}`;
        const res = await fetch(url);
        const json = await res.json();
        
        // Buscar coincidencia exacta
        const user = json.users.find(u => u.user.username.toLowerCase() === username.toLowerCase());
        if (user) return user.user.pk;
        
        // Si no hay exacta, devolver el primero
        return json.users[0]?.user.pk || null;
      } catch (e) {
        console.error("Error resolviendo usuario:", e);
        return null;
      }
    }
  
    function getFollowersUrl(userId, cursor) {
      const variables = JSON.stringify({
        id: userId,
        include_reel: true,
        fetch_mutual: true,
        first: 50,
        after: cursor || undefined
      });
      return `https://www.instagram.com/graphql/query/?query_hash=${CONFIG.QUERY_HASH}&variables=${encodeURIComponent(variables)}`;
    }
  
    function getFollowUrl(userId) {
      return `https://www.instagram.com/web/friendships/${userId}/follow/`;
    }
  
    // ============================================
    // MOTOR UI (Vanilla JS)
    // ============================================
    function setState(updates) {
      Object.assign(state, updates);
      render();
    }
  
    function h(tag, props = {}, children = []) {
      const el = document.createElement(tag);
      if (props) {
        Object.entries(props).forEach(([k, v]) => {
          if (k.startsWith('on') && typeof v === 'function') {
            el.addEventListener(k.substring(2).toLowerCase(), v);
          } else if (k === 'style' && typeof v === 'object') {
            Object.assign(el.style, v);
          } else if (k === 'className') el.className = v;
          else if (['checked', 'disabled', 'value', 'placeholder', 'src', 'type'].includes(k)) el[k] = v;
          else el.setAttribute(k, v);
        });
      }
      const kids = Array.isArray(children) ? children : [children];
      kids.forEach(child => {
        if (child == null || child === false) return;
        el.appendChild(child instanceof Node ? child : document.createTextNode(child));
      });
      return el;
    }
  
    // ============================================
    // ESTILOS
    // ============================================
    const styles = `
      .if-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 9999; background: #000; color: #fff; font-family: -apple-system, system-ui, sans-serif; overflow-y: auto; }
      .if-header { position: sticky; top: 0; background: #111; padding: 15px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #333; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
      .if-input-group { background: #333; padding: 5px; border-radius: 8px; display: flex; width: 100%; margin-bottom: 15px; border: 1px solid #444; }
      .if-input { background: transparent; border: none; color: #fff; padding: 10px; flex: 1; outline: none; }
      .if-sidebar { width: 320px; background: #1c1c1e; padding: 20px; border-radius: 12px; display: flex; flex-direction: column; height: 100%; }
      .if-content { display: flex; padding: 20px; gap: 20px; max-width: 1200px; margin: 0 auto; height: calc(100vh - 80px); }
      .if-results-container { flex: 1; overflow-y: auto; }
      .if-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; }
      .if-card { background: #1c1c1e; padding: 15px; border-radius: 10px; display: flex; align-items: center; gap: 15px; border: 1px solid #333; cursor: pointer; transition: all 0.2s; }
      .if-card:hover { background: #2c2c2e; transform: translateY(-2px); }
      .if-card.selected { border-color: #34c759; background: rgba(52, 199, 89, 0.1); }
      .if-avatar { width: 44px; height: 44px; border-radius: 50%; background: #333; object-fit: cover; }
      .if-info { flex: 1; overflow: hidden; }
      .if-btn { width: 100%; padding: 12px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; margin-top: 10px; }
      .if-btn-primary { background: #34c759; color: white; }
      .if-btn-secondary { background: #333; color: white; }
      .if-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .if-badge { background: #333; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 5px; }
      .if-progress { position: fixed; top: 0; left: 0; height: 3px; background: #34c759; transition: width 0.3s; z-index: 10000; }
      .if-log { margin-top: auto; max-height: 200px; overflow-y: auto; background: #000; padding: 10px; border-radius: 8px; border: 1px solid #333; font-family: monospace; font-size: 0.8rem; }
      .if-log-item { padding: 4px 0; border-bottom: 1px solid #222; display: flex; justify-content: space-between; }
      .if-log-success { color: #34c759; } .if-log-error { color: #ff3b30; } .if-log-wait { color: #ff9f0a; }
    `;
  
    // ============================================
    // LOGICA
    // ============================================
    const addLog = (type, text) => {
      state.logs.push({ type, text, time: new Date().toLocaleTimeString() });
      render();
      setTimeout(() => {
        const logDiv = document.querySelector('.if-log');
        if (logDiv) logDiv.scrollTop = logDiv.scrollHeight;
      }, 50);
    };
  
    const startScanProcess = async () => {
      if (!state.targetUsername) return alert("Escribe un nombre de usuario primero.");
      
      setState({ status: "resolving" });
      const targetId = await resolveUserId(state.targetUsername);
      
      if (!targetId) {
        alert(`No se encontró el usuario "${state.targetUsername}".`);
        setState({ status: "initial" });
        return;
      }
  
      state.targetId = targetId;
      state.results = []; // Limpiar resultados anteriores
      state.selected = [];
      runScan();
    };
  
    const runScan = async () => {
      setState({ status: "scanning" });
      
      let hasNext = true;
      let cursor = null;
      let count = 0;
  
      try {
        while (hasNext) {
          if (state.status !== "scanning") break;
  
          const res = await fetch(getFollowersUrl(state.targetId, cursor));
          const json = await res.json();
  
          if (!json.data || !json.data.user) {
            alert("Error de API. Intenta más tarde.");
            setState({ status: "initial" });
            return;
          }
  
          const edgeData = json.data.user.edge_followed_by;
          hasNext = edgeData.page_info.has_next_page;
          cursor = edgeData.page_info.end_cursor;
  
          if (count === 0) state.stats.total = edgeData.count;
  
          // FILTRO: Traer seguidores del objetivo que YO NO sigo
          const newUsers = edgeData.edges
            .map(e => e.node)
            .filter(user => user.followed_by_viewer === false); 
  
          state.results.push(...newUsers);
          count += edgeData.edges.length;
          state.stats.scanned = count;
          
          render();
          await sleep(Math.random() * 800 + 500);
        }
      } catch (e) {
        console.error(e);
        alert("Error de red o límite de API alcanzado.");
      }
      setState({ status: "ready" });
    };
  
    const runFollow = async () => {
      if (state.selected.length > CONFIG.MAX_SESSION_FOLLOWS) {
        if (!confirm(`⚠️ Cuidado: ${state.selected.length} usuarios supera el límite recomendado de seguridad (${CONFIG.MAX_SESSION_FOLLOWS}). ¿Seguir?`)) return;
      }
  
      setState({ status: "following" });
      const csrf = getCookie("csrftoken");
      let successCount = 0;
      const total = state.selected.length;
  
      for (let i = 0; i < total; i++) {
        if (state.status !== "following") break;
  
        const user = state.selected[i];
        const percent = ((i) / total) * 100;
        state.progress = percent;
        render();
  
        if (i > 0 && i % CONFIG.LONG_PAUSE_AFTER_COUNT === 0) {
          addLog("wait", `☕ Descanso largo (${CONFIG.LONG_PAUSE_DURATION/1000}s)...`);
          await sleep(CONFIG.LONG_PAUSE_DURATION);
        }
  
        const delay = getHumanDelay();
        state.eta = Math.round(((total - i) * (delay/1000)) / 60);
        render();
  
        addLog("info", `⏳ Esperando ${Math.round(delay/1000)}s... (@${user.username})`);
        await sleep(delay);
  
        try {
          const res = await fetch(getFollowUrl(user.id), {
            method: "POST",
            headers: {
              "x-csrftoken": csrf,
              "x-instagram-ajax": "1",
              "x-requested-with": "XMLHttpRequest"
            }
          });
          const data = await res.json();
          
          if (data.status === "ok" || data.result === "following") {
            addLog("success", `✅ Seguido: ${user.username}`);
            successCount++;
          } else {
            addLog("error", `❌ Fallo: ${user.username}`);
          }
        } catch (e) {
          addLog("error", `❌ Error Red: ${user.username}`);
        }
      }
  
      setState({ status: "done", progress: 100 });
      alert(`Proceso finalizado. Seguidos: ${successCount}`);
    };
  
    // ============================================
    // VISTAS
    // ============================================
    const InitialView = () => {
      return h("div", { className: "if-overlay", style: { display: "flex", alignItems: "center", justifyContent: "center" } }, [
        h("div", { style: { textAlign: "center", maxWidth: '450px', padding: '40px', background: '#1c1c1e', borderRadius: '20px' } }, [
          h("h1", { style: { color: "#34c759", fontSize: "2rem", marginBottom: '10px' } }, "Competitor Follower"),
          h("p", { style: { margin: "10px 0 20px 0", color: "#aaa" } }, "Roba seguidores de tu competencia de forma segura."),
          
          h("div", { className: "if-input-group" }, [
            h("span", { style: { padding: "10px", color: "#888" } }, "@"),
            h("input", { 
              className: "if-input", 
              placeholder: "Usuario Objetivo (ej: elonmusk)", 
              value: state.targetUsername,
              oninput: (e) => { state.targetUsername = e.target.value; }
            })
          ]),
  
          h("button", { 
            className: "if-btn if-btn-primary", 
            style: { fontSize: "1.1rem" }, 
            disabled: state.status === "resolving",
            onClick: startScanProcess 
          }, state.status === "resolving" ? "BUSCANDO USUARIO..." : "ESCANEAR SEGUIDORES"),
          
          h("button", { 
            className: "if-btn if-btn-secondary", 
            onClick: closeApp 
          }, "Cerrar")
        ])
      ]);
    };
  
    const MainView = () => {
      const filtered = state.results.filter(u => 
        u.username.toLowerCase().includes(state.searchTerm.toLowerCase())
      );
  
      const toggleSelect = (user) => {
        if (state.status === "following") return;
        const exists = state.selected.find(u => u.id === user.id);
        state.selected = exists ? state.selected.filter(u => u.id !== user.id) : [...state.selected, user];
        render();
      };
  
      const selectAll = () => {
        state.selected = state.selected.length === filtered.length ? [] : [...filtered];
        render();
      };
  
      return h("div", { className: "if-overlay" }, [
        state.status === "following" ? h("div", { className: "if-progress", style: { width: `${state.progress}%` } }) : null,
        
        h("header", { className: "if-header" }, [
          h("div", { className: "if-logo" }, [
            h("span", {}, "🎯 Competitor Scanner"),
            h("span", { style: { fontSize: "0.9rem", color: "#888", marginLeft: '10px' } }, 
              state.status === "scanning" ? "Escaneando..." : `Objetivo: @${state.targetUsername}`)
          ]),
          h("button", { className: "if-close", onClick: closeApp }, "×")
        ]),
  
        h("div", { className: "if-content" }, [
          h("aside", { className: "if-sidebar" }, [
            h("h3", { style: { margin: '0 0 15px 0' } }, "Panel de Control"),
            h("div", { className: "if-stat-row" }, [h("span", {}, "Escaneados:"), h("span", { className: "if-stat-val" }, state.results.length)]),
            h("div", { className: "if-stat-row" }, [h("span", {}, "Seleccionados:"), h("span", { className: "if-stat-val", style: { color: '#34c759' } }, state.selected.length)]),
            
            h("input", {
              className: "if-input", 
              style: { background: "#333", width: "100%", borderRadius: "6px", margin: "10px 0" },
              placeholder: "Buscar en lista...",
              value: state.searchTerm,
              oninput: (e) => { state.searchTerm = e.target.value; render(); }
            }),
  
            h("button", { className: "if-btn if-btn-secondary", onClick: selectAll }, 
              state.selected.length > 0 ? "Deseleccionar Todo" : "Seleccionar Todo"),
  
            h("button", {
              className: "if-btn if-btn-primary",
              disabled: state.selected.length === 0 || state.status === "following" || state.status === "scanning",
              onClick: runFollow
            }, state.status === "following" ? "SIGUIENDO..." : `SEGUIR (${state.selected.length})`),
            
            h("div", { className: "if-log" }, [
              ...state.logs.map(log => h("div", { className: `if-log-item if-log-${log.type}` }, [
                h("span", {}, log.text), h("span", { style: { color: '#555', fontSize: '0.7rem' } }, log.time)
              ]))
            ])
          ]),
  
          h("div", { className: "if-results-container" }, [
            h("main", { className: "if-results" }, 
              filtered.map(user => {
                const isSelected = !!state.selected.find(u => u.id === user.id);
                return h("div", {
                  className: `if-card ${isSelected ? "selected" : ""}`,
                  onclick: () => toggleSelect(user)
                }, [
                  h("img", { src: user.profile_pic_url, className: "if-avatar" }),
                  h("div", { className: "if-info" }, [
                    h("div", { className: "if-username" }, [
                      user.username,
                      user.is_verified ? h("span", { className: "if-badge", style: { background: '#1da1f2' } }, "✔") : null
                    ]),
                    h("div", { className: "if-fullname" }, user.full_name)
                  ]),
                  h("div", { 
                    style: { 
                      width: '20px', height: '20px', borderRadius: '50%', 
                      border: isSelected ? '6px solid #34c759' : '2px solid #555',
                      background: isSelected ? '#34c759' : 'transparent'
                    } 
                  })
                ]);
              })
            )
          ])
        ])
      ]);
    };
  
    const render = () => {
      const root = document.getElementById("instagram-safe-follower-root");
      if (root) {
        root.innerHTML = "";
        root.appendChild(state.status === "initial" || state.status === "resolving" ? InitialView() : MainView());
      }
    };
  
    const closeApp = () => {
      const root = document.getElementById("instagram-safe-follower-root");
      if (root) root.remove();
    };
  
    const init = () => {
      closeApp();
      const styleSheet = document.createElement("style");
      styleSheet.innerText = styles;
      document.head.appendChild(styleSheet);
      const rootDiv = document.createElement("div");
      rootDiv.id = "instagram-safe-follower-root";
      document.body.appendChild(rootDiv);
      render();
    };
  
    init();
  })();
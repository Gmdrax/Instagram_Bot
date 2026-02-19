(() => {
    "use strict";
  
    // ============================================
    // CONFIGURACIÓN PRO (HUMANIZADA)
    // ============================================
    const CONFIG = {
      QUERY_HASH: "c76146de99bb02f6415203be841dd25a",
      FOLLOWERS_PER_PAGE: 50,
      
      // TIEMPOS (Curva de campana)
      // Promedio de espera entre acciones (segundos)
      MEAN_DELAY: 45, 
      // Desviación estándar (variación natural)
      DEVIATION: 15,
      
      // DESCANSOS
      LONG_PAUSE_EVERY_X_ACTIONS: 8,  // Descanso cada 8-12 acciones (aleatorio)
      LONG_PAUSE_MINUTES: 3,          // Minutos de descanso
      
      // SEGURIDAD
      MAX_SESSION_FOLLOWS: 40         // Límite duro sugerido
    };
  
    // ============================================
    // ESTADO GLOBAL
    // ============================================
    const state = {
      status: "initial", 
      targetUsername: "",
      targetId: null,
      results: [],
      selected: [],
      logs: [],
      progress: 0,
      searchTerm: "",
      stats: { scanned: 0, total: 0 },
      eta: 0,
      currentAction: "Esperando..."
    };
  
    // ============================================
    // UTILIDADES MATEMÁTICAS (Humanización)
    // ============================================
    
    // Generador de números con distribución normal (Box-Muller transform)
    function getGaussianRandom(mean, stdev) {
      const u = 1 - Math.random(); 
      const v = Math.random();
      const z = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
      // Asegurar que no sea negativo ni excesivamente bajo
      const val = z * stdev + mean;
      return Math.max(10, val) * 1000; // Mínimo 10 segundos absolutos
    }
  
    function getCookie(name) {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop().split(";").shift();
      return null;
    }
  
    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  
    async function resolveUserId(username) {
      try {
        const timestamp = Date.now();
        // Añadimos jitter aleatorio a la llamada
        await sleep(Math.random() * 1000 + 500); 
        
        const url = `https://www.instagram.com/web/search/topsearch/?context=blended&query=${username}&rank_token=0.6&include_reel=true&_=${timestamp}`;
        const res = await fetch(url);
        const json = await res.json();
        const user = json.users.find(u => u.user.username.toLowerCase() === username.toLowerCase());
        if (user) return user.user.pk;
        return json.users[0]?.user.pk || null;
      } catch (e) {
        console.error(e);
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
    // MOTOR UI
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
      .if-sidebar { width: 340px; background: #1c1c1e; padding: 20px; border-radius: 12px; display: flex; flex-direction: column; height: 100%; }
      .if-content { display: flex; padding: 20px; gap: 20px; max-width: 1200px; margin: 0 auto; height: calc(100vh - 80px); }
      .if-results-container { flex: 1; overflow-y: auto; }
      .if-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; }
      .if-card { background: #1c1c1e; padding: 15px; border-radius: 10px; display: flex; align-items: center; gap: 15px; border: 1px solid #333; cursor: pointer; transition: all 0.2s; position: relative; overflow: hidden; }
      .if-card:hover { background: #2c2c2e; transform: translateY(-2px); }
      .if-card.selected { border-color: #34c759; background: rgba(52, 199, 89, 0.1); }
      .if-avatar { width: 44px; height: 44px; border-radius: 50%; background: #333; object-fit: cover; }
      .if-info { flex: 1; overflow: hidden; }
      .if-btn { width: 100%; padding: 12px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; margin-top: 5px; }
      .if-btn-primary { background: #34c759; color: white; }
      .if-btn-secondary { background: #333; color: white; }
      .if-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .if-badge { background: #333; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 5px; display: inline-flex; align-items: center; gap: 3px; }
      .if-progress { position: fixed; top: 0; left: 0; height: 3px; background: #34c759; transition: width 0.3s; z-index: 10000; }
      .if-log { margin-top: auto; max-height: 200px; overflow-y: auto; background: #000; padding: 10px; border-radius: 8px; border: 1px solid #333; font-family: monospace; font-size: 0.8rem; }
      .if-log-item { padding: 4px 0; border-bottom: 1px solid #222; display: flex; justify-content: space-between; }
      .if-log-success { color: #34c759; } .if-log-error { color: #ff3b30; } .if-log-wait { color: #ff9f0a; } .if-log-info { color: #0a84ff; }
      .if-eta { font-size: 0.85rem; color: #ff9f0a; font-weight: bold; }
      .if-status-bar { border-left: 3px solid transparent; }
      .if-status-public { border-left-color: #34c759; }
      .if-status-private { border-left-color: #ff3b30; }
    `;
  
    // ============================================
    // LÓGICA
    // ============================================
    const addLog = (type, text) => {
      state.currentAction = text;
      state.logs.push({ type, text, time: new Date().toLocaleTimeString() });
      render();
      setTimeout(() => {
        const logDiv = document.querySelector('.if-log');
        if (logDiv) logDiv.scrollTop = logDiv.scrollHeight;
      }, 50);
    };
  
    const startScanProcess = async () => {
      if (!state.targetUsername) return alert("Escribe un nombre de usuario.");
      
      setState({ status: "resolving", currentAction: "Buscando ID de usuario..." });
      const targetId = await resolveUserId(state.targetUsername);
      
      if (!targetId) {
        alert(`No se encontró el usuario "${state.targetUsername}".`);
        setState({ status: "initial" });
        return;
      }
  
      state.targetId = targetId;
      state.results = [];
      state.selected = [];
      runScan();
    };
  
    const runScan = async () => {
      setState({ status: "scanning", currentAction: "Escaneando seguidores..." });
      let hasNext = true;
      let cursor = null;
      let count = 0;
  
      try {
        while (hasNext) {
          if (state.status !== "scanning") break;
  
          const res = await fetch(getFollowersUrl(state.targetId, cursor));
          const json = await res.json();
  
          if (!json.data || !json.data.user) {
            alert("Error de API. Pausando seguridad.");
            setState({ status: "initial" });
            return;
          }
  
          const edgeData = json.data.user.edge_followed_by;
          hasNext = edgeData.page_info.has_next_page;
          cursor = edgeData.page_info.end_cursor;
  
          if (count === 0) state.stats.total = edgeData.count;
  
          const newUsers = edgeData.edges
            .map(e => e.node)
            .filter(user => user.followed_by_viewer === false); 
  
          state.results.push(...newUsers);
          count += edgeData.edges.length;
          state.stats.scanned = count;
          
          render();
          // Pausa aleatoria durante el escaneo para no saturar
          await sleep(Math.random() * 1000 + 800);
        }
      } catch (e) {
        console.error(e);
        alert("Error de red.");
      }
      setState({ status: "ready", currentAction: "Listo para seleccionar" });
    };
  
    const runFollow = async () => {
      if (state.selected.length > CONFIG.MAX_SESSION_FOLLOWS) {
        if (!confirm(`⚠️ ALERTA: ${state.selected.length} usuarios es riesgoso. El límite seguro es ${CONFIG.MAX_SESSION_FOLLOWS}. ¿Continuar bajo tu riesgo?`)) return;
      }
  
      setState({ status: "following" });
      const csrf = getCookie("csrftoken");
      let successCount = 0;
      const total = state.selected.length;
      
      // Aleatoriedad en el intervalo de descanso largo (entre 8 y 12 acciones)
      let nextLongPause = Math.floor(Math.random() * 4) + CONFIG.LONG_PAUSE_EVERY_X_ACTIONS;
      let actionCounter = 0;
  
      for (let i = 0; i < total; i++) {
        if (state.status !== "following") break;
  
        const user = state.selected[i];
        const percent = ((i) / total) * 100;
        state.progress = percent;
        
        // Chequeo de descanso largo
        actionCounter++;
        if (actionCounter >= nextLongPause) {
          const pauseTime = CONFIG.LONG_PAUSE_MINUTES * 60 * 1000;
          addLog("wait", `☕ Pausa humana de ${CONFIG.LONG_PAUSE_MINUTES} min...`);
          state.currentAction = "Descansando...";
          render();
          await sleep(pauseTime);
          
          // Resetear contador y calcular siguiente pausa aleatoria
          actionCounter = 0;
          nextLongPause = Math.floor(Math.random() * 4) + CONFIG.LONG_PAUSE_EVERY_X_ACTIONS;
        }
  
        // Calcular delay humano (Curva Gaussiana)
        const delay = getGaussianRandom(CONFIG.MEAN_DELAY, CONFIG.DEVIATION);
        
        // Simular "micro-actividad" antes de la acción (pensar, mover mouse)
        state.eta = Math.round(((total - i) * (delay/1000)) / 60);
        addLog("info", `⏳ Simulando interacción... (${Math.round(delay/1000)}s)`);
        render();
        
        await sleep(delay);
  
        try {
          state.currentAction = `Siguiendo a ${user.username}...`;
          render();
          
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
            addLog("error", `❌ Fallo (Posible límite): ${user.username}`);
            // Si falla, hacemos una pausa extra de seguridad
            await sleep(5000);
          }
        } catch (e) {
          addLog("error", `❌ Error Red: ${user.username}`);
        }
      }
  
      setState({ status: "done", progress: 100, currentAction: "Finalizado" });
      alert(`Proceso finalizado. Seguidos: ${successCount}`);
    };
  
    // ============================================
    // VISTAS
    // ============================================
    const InitialView = () => {
      return h("div", { className: "if-overlay", style: { display: "flex", alignItems: "center", justifyContent: "center" } }, [
        h("div", { style: { textAlign: "center", maxWidth: '450px', padding: '40px', background: '#1c1c1e', borderRadius: '20px', border: '1px solid #333' } }, [
          h("h1", { style: { color: "#34c759", fontSize: "2rem", marginBottom: '5px' } }, "Competitor Pro"),
          h("span", { style: { fontSize: "0.8rem", background: "#333", padding: "4px 8px", borderRadius: "4px", color: "#aaa" } }, "Modo Indetectable Activo"),
          
          h("p", { style: { margin: "20px 0", color: "#aaa", lineHeight: "1.5" } }, "Este modo utiliza tiempos variables (distribución normal) y pausas aleatorias para imitar el comportamiento humano."),
          
          h("div", { className: "if-input-group" }, [
            h("span", { style: { padding: "10px", color: "#888" } }, "@"),
            h("input", { 
              className: "if-input", 
              placeholder: "Usuario Competencia", 
              value: state.targetUsername,
              oninput: (e) => { state.targetUsername = e.target.value; }
            })
          ]),
  
          h("button", { 
            className: "if-btn if-btn-primary", 
            style: { fontSize: "1.1rem" }, 
            disabled: state.status === "resolving",
            onClick: startScanProcess 
          }, state.status === "resolving" ? "ANALIZANDO..." : "BUSCAR OBJETIVO"),
          
          h("button", { className: "if-btn if-btn-secondary", onClick: closeApp }, "Salir")
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
  
      const selectPublic = () => {
        const publicUsers = filtered.filter(u => !u.is_private);
        state.selected = [...publicUsers];
        render();
      };
  
      const selectPrivate = () => {
        const privateUsers = filtered.filter(u => u.is_private);
        state.selected = [...privateUsers];
        render();
      };
  
      return h("div", { className: "if-overlay" }, [
        state.status === "following" ? h("div", { className: "if-progress", style: { width: `${state.progress}%` } }) : null,
        
        h("header", { className: "if-header" }, [
          h("div", { className: "if-logo" }, [
            h("span", {}, "🛡️ Competitor Pro"),
            h("span", { style: { fontSize: "0.85rem", color: "#888", marginLeft: '10px', borderLeft: '1px solid #333', paddingLeft: '10px' } }, 
              state.status === "scanning" ? "Escaneando..." : state.currentAction)
          ]),
          h("div", { style: { display: 'flex', alignItems: 'center', gap: '15px'} }, [
            state.status === "following" ? h("span", { className: "if-eta" }, `ETA: ~${state.eta} min`) : null,
            h("button", { className: "if-close", onClick: closeApp }, "×")
          ])
        ]),
  
        h("div", { className: "if-content" }, [
          h("aside", { className: "if-sidebar" }, [
            h("h3", { style: { margin: '0 0 15px 0' } }, "Control Seguro"),
            
            h("div", { style: { background: '#252525', padding: '10px', borderRadius: '8px', marginBottom: '15px' } }, [
              h("div", { className: "if-stat-row" }, [h("span", {}, "Disponibles:"), h("span", { className: "if-stat-val" }, state.results.length)]),
              h("div", { className: "if-stat-row" }, [h("span", {}, "A Seguir:"), h("span", { className: "if-stat-val", style: { color: '#34c759' } }, state.selected.length)]),
            ]),
            
            h("input", {
              className: "if-input", 
              style: { background: "#2c2c2e", width: "100%", borderRadius: "6px", margin: "0 0 10px 0", border: "1px solid #333" },
              placeholder: "Filtrar resultados...",
              value: state.searchTerm,
              oninput: (e) => { state.searchTerm = e.target.value; render(); }
            }),
  
            h("button", { className: "if-btn if-btn-secondary", onClick: selectAll }, 
              state.selected.length > 0 ? "Deseleccionar Todo" : "Seleccionar Todo"),
  
            // NUEVOS BOTONES DE SELECCIÓN
            h("div", { style: { display: 'flex', gap: '5px', marginTop: '5px' } }, [
              h("button", { className: "if-btn if-btn-secondary", style: { fontSize: '0.8rem', marginTop: '0', flex: 1 }, onClick: selectPublic }, "Solo Públicas"),
              h("button", { className: "if-btn if-btn-secondary", style: { fontSize: '0.8rem', marginTop: '0', flex: 1 }, onClick: selectPrivate }, "Solo Privadas")
            ]),
  
            h("button", {
              className: "if-btn if-btn-primary",
              disabled: state.selected.length === 0 || state.status === "following" || state.status === "scanning",
              onClick: runFollow
            }, state.status === "following" ? "EJECUTANDO..." : `SEGUIR SELECCIONADOS`),
            
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
                const isPrivate = user.is_private;
                return h("div", {
                  className: `if-card ${isSelected ? "selected" : ""} ${isPrivate ? "if-status-private" : "if-status-public"}`,
                  onclick: () => toggleSelect(user)
                }, [
                  h("img", { src: user.profile_pic_url, className: "if-avatar" }),
                  h("div", { className: "if-info" }, [
                    h("div", { className: "if-username" }, [
                      user.username,
                      user.is_verified ? h("span", { className: "if-badge", style: { background: '#1da1f2' } }, "✔") : null
                    ]),
                    h("div", { className: "if-fullname" }, user.full_name),
                    // MARCADORES VISUALES
                    h("div", { style: { marginTop: '5px' } }, [
                      isPrivate 
                        ? h("span", { className: "if-badge", style: { background: 'rgba(255, 59, 48, 0.2)', color: '#ff3b30', border: '1px solid #ff3b30' } }, "🔒 Privada")
                        : h("span", { className: "if-badge", style: { background: 'rgba(52, 199, 89, 0.2)', color: '#34c759', border: '1px solid #34c759' } }, "🔓 Pública")
                    ])
                  ]),
                  h("div", { 
                    style: { 
                      width: '22px', height: '22px', borderRadius: '50%', 
                      border: isSelected ? '6px solid #34c759' : '2px solid #444',
                      background: isSelected ? '#34c759' : 'transparent',
                      transition: 'all 0.1s'
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
        // PRESERVAR SCROLL
        const container = root.querySelector('.if-results-container');
        const savedScroll = container ? container.scrollTop : 0;
        const logContainer = root.querySelector('.if-log');
        const savedLogScroll = logContainer ? logContainer.scrollTop : 0;
  
        root.innerHTML = "";
        root.appendChild(state.status === "initial" || state.status === "resolving" ? InitialView() : MainView());
  
        // RESTAURAR SCROLL
        const newContainer = root.querySelector('.if-results-container');
        if (newContainer) newContainer.scrollTop = savedScroll;
        
        const newLogContainer = root.querySelector('.if-log');
        // Solo restaurar log si no estaba al final (autoscroll se maneja en addLog)
        if (newLogContainer && savedLogScroll > 0) newLogContainer.scrollTop = savedLogScroll;
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
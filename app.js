(function () {
  const POLL_MS = 1200;
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const clientIdKey = "femrud_multiplayer_client_id";
  const deviceNameKey = "femrud_multiplayer_device_name";
  const deviceAvatarKey = "femrud_multiplayer_device_avatar";
  const activeRoomKey = "femrud_multiplayer_active_room";

  const state = {
    clientId: localStorage.getItem(clientIdKey) || ("client_" + Math.random().toString(36).slice(2, 10)),
    currentRoom: null,
    pollTimer: null,
    lastRenderedSignature: "",
    pendingSipDistribution: null,
    lastNotificationId: "",
    modalConfirm: null,
    modalCancel: null,
    deviceName: localStorage.getItem(deviceNameKey) || "",
    deviceAvatar: localStorage.getItem(deviceAvatarKey) || "",
  };

  localStorage.setItem(clientIdKey, state.clientId);

  const els = {
    lobbyScreen: document.getElementById("lobbyScreen"),
    roomScreen: document.getElementById("roomScreen"),
    roomTitle: document.getElementById("roomTitle"),
    roomStatusText: document.getElementById("roomStatusText"),
    roomCodeText: document.getElementById("roomCodeText"),
    roomContent: document.getElementById("roomContent"),
    resumeRoomCard: document.getElementById("resumeRoomCard"),
    resumeRoomText: document.getElementById("resumeRoomText"),
    resumeRoomBtn: document.getElementById("resumeRoomBtn"),
    backToMenuBtn: document.getElementById("backToMenuBtn"),
    leaveRoomBtn: document.getElementById("leaveRoomBtn"),
    openFelesesBtn: document.getElementById("openFelesesBtn"),
    openFelesesRoomBtn: document.getElementById("openFelesesRoomBtn"),
    joinCodeInput: document.getElementById("joinCodeInput"),
    joinRoomBtn: document.getElementById("joinRoomBtn"),
    deviceNameInput: document.getElementById("deviceNameInput"),
    deviceAvatarInput: document.getElementById("deviceAvatarInput"),
    deviceAvatarPreview: document.getElementById("deviceAvatarPreview"),
    modalRoot: document.getElementById("modalRoot"),
    modalEyebrow: document.getElementById("modalEyebrow"),
    modalTitle: document.getElementById("modalTitle"),
    modalText: document.getElementById("modalText"),
    modalConfirmBtn: document.getElementById("modalConfirmBtn"),
    modalCancelBtn: document.getElementById("modalCancelBtn"),
    managerRoot: document.getElementById("managerRoot"),
    managerEyebrow: document.getElementById("managerEyebrow"),
    managerTitle: document.getElementById("managerTitle"),
    managerBody: document.getElementById("managerBody"),
    managerCloseBtn: document.getElementById("managerCloseBtn"),
  };

  function setAvatarPreview(el, avatar) {
    el.style.backgroundImage = avatar ? `url(${avatar})` : "";
  }

  function openFelesesWindow() {
    window.open("feleses.html", "_blank", "noopener");
  }

  function isEditingField(element) {
    if (!element) return false;
    if (element.closest && element.closest("#modalRoot")) return false;
    return (
      element.tagName === "INPUT" ||
      element.tagName === "SELECT" ||
      element.tagName === "TEXTAREA" ||
      element.isContentEditable
    );
  }

  function saveDeviceProfile(nameOverride) {
    if (typeof nameOverride === "string") {
      state.deviceName = nameOverride.trim();
    } else {
      state.deviceName = els.deviceNameInput.value.trim();
    }
    els.deviceNameInput.value = state.deviceName;
    localStorage.setItem(deviceNameKey, state.deviceName);
    localStorage.setItem(deviceAvatarKey, state.deviceAvatar);
  }

  function saveActiveRoom() {
    if (!state.currentRoom) {
      localStorage.removeItem(activeRoomKey);
      return;
    }
    localStorage.setItem(activeRoomKey, JSON.stringify({
      code: state.currentRoom.code,
      game: state.currentRoom.game,
    }));
  }

  function loadActiveRoom() {
    try {
      return JSON.parse(localStorage.getItem(activeRoomKey) || "null");
    } catch {
      return null;
    }
  }

  function showModal({ eyebrow = "Üzenet", title, text, confirmLabel = "Rendben", cancelLabel = "", onConfirm, onCancel }) {
    els.modalEyebrow.textContent = eyebrow;
    els.modalTitle.textContent = title;
    els.modalText.textContent = text;
    els.modalConfirmBtn.textContent = confirmLabel;
    els.modalCancelBtn.textContent = cancelLabel || "Mégse";
    els.modalCancelBtn.classList.toggle("hidden", !cancelLabel);
    state.modalConfirm = onConfirm || null;
    state.modalCancel = onCancel || null;
    els.modalRoot.classList.remove("hidden");
  }

  function hideModal() {
    els.modalRoot.classList.add("hidden");
    state.modalConfirm = null;
    state.modalCancel = null;
  }

  function closePlayerManager() {
    els.managerRoot.classList.add("hidden");
    els.managerBody.innerHTML = "";
  }

  async function apiAction(action, payload) {
    const response = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || "Ismeretlen hiba");
    }
    return data;
  }

  async function apiState() {
    const params = new URLSearchParams({
      room: state.currentRoom.code,
      client_id: state.clientId,
    });
    const response = await fetch("/api/state?" + params.toString());
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || "Nem sikerült lekérni az állapotot.");
    }
    return data.room;
  }

  function schedulePoll() {
    clearTimeout(state.pollTimer);
    if (!state.currentRoom) return;
    state.pollTimer = setTimeout(async () => {
      try {
        const room = await apiState();
        const nextSignature = JSON.stringify(room);
        state.currentRoom = room;
        updateResumeCard();
        maybeShowIncomingNotification(room);
        if (!els.roomScreen.classList.contains("hidden") && !isEditingField(document.activeElement) && nextSignature !== state.lastRenderedSignature) {
          renderCurrentRoom();
        }
      } catch (error) {
        console.error(error);
      } finally {
        schedulePoll();
      }
    }, POLL_MS);
  }

  function isHost(room) {
    return room.state.is_host;
  }

  function ownPlayer(room) {
    return room.state.my_player;
  }

  function updateResumeCard() {
    const activeRoom = state.currentRoom || loadActiveRoom();
    if (!activeRoom) {
      els.resumeRoomCard.classList.add("hidden");
      return;
    }

    const label = activeRoom.game === "kings" ? "Kings Cup" : "Buszozás";
    els.resumeRoomText.textContent = `${label} szoba: ${activeRoom.code}. A progressz megmaradt, bármikor visszaléphetsz.`;
    els.resumeRoomCard.classList.remove("hidden");
  }

  function setLobbyVisible(preserveRoom) {
    els.lobbyScreen.classList.remove("hidden");
    els.roomScreen.classList.add("hidden");
    if (preserveRoom) {
      updateResumeCard();
      return;
    }
    state.currentRoom = null;
    state.lastRenderedSignature = "";
    clearTimeout(state.pollTimer);
    saveActiveRoom();
    updateResumeCard();
  }

  function setRoomVisible() {
    els.lobbyScreen.classList.add("hidden");
    els.roomScreen.classList.remove("hidden");
    saveActiveRoom();
    updateResumeCard();
  }

  async function createRoom(game) {
    saveDeviceProfile();
    state.pendingSipDistribution = null;
    const result = await apiAction("create_room", {
      game,
      client_id: state.clientId,
    });
    state.currentRoom = result.room;
    if (game === "bus") {
      await apiAction("join_room", {
        room: state.currentRoom.code,
        client_id: state.clientId,
        name: state.deviceName || "Játékos",
        avatar: state.deviceAvatar || "",
      });
      state.currentRoom = (await apiState());
    } else {
      await apiAction("join_room", {
        room: state.currentRoom.code,
        client_id: state.clientId,
        name: state.deviceName || "Játékos",
      });
      state.currentRoom = (await apiState());
    }
    setRoomVisible();
    renderCurrentRoom();
    schedulePoll();
  }

  async function joinRoom() {
    saveDeviceProfile();
    state.pendingSipDistribution = null;
    const roomCode = els.joinCodeInput.value.trim().toUpperCase();
    if (!roomCode) {
      showModal({ title: "Hiányzó szobakód", text: "Írj be egy érvényes szobakódot." });
      return;
    }

    try {
      const result = await apiAction("join_room", {
        room: roomCode,
        client_id: state.clientId,
        name: state.deviceName || "Játékos",
        avatar: state.deviceAvatar || "",
      });
      state.currentRoom = result.room;
      setRoomVisible();
      renderCurrentRoom();
      schedulePoll();
    } catch (error) {
      showModal({ title: "Nem sikerült csatlakozni", text: error.message });
    }
  }

  async function rejoinSavedRoom() {
    const saved = loadActiveRoom();
    if (!saved || !saved.code) return;
    try {
      const result = await apiAction("join_room", {
        room: saved.code,
        client_id: state.clientId,
        name: state.deviceName || "Játékos",
        avatar: state.deviceAvatar || "",
      });
      state.currentRoom = result.room;
      setRoomVisible();
      renderCurrentRoom();
      schedulePoll();
    } catch {
      localStorage.removeItem(activeRoomKey);
      updateResumeCard();
    }
  }

  async function leaveCurrentRoom() {
    if (!state.currentRoom) return;
    await apiAction("leave_room", {
      room: state.currentRoom.code,
      client_id: state.clientId,
    });
    state.currentRoom = null;
    state.pendingSipDistribution = null;
    state.lastRenderedSignature = "";
    localStorage.removeItem(activeRoomKey);
    clearTimeout(state.pollTimer);
    setLobbyVisible();
  }

  function renderPlayerAvatar(avatar, fallback) {
    return `<div class="avatar-small" style="${avatar ? `background-image:url(${escapeHtml(avatar)})` : ""}"></div><div><strong>${escapeHtml(fallback)}</strong></div>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function createButton(label, className, onClick, disabled) {
    const button = document.createElement("button");
    button.textContent = label;
    button.className = className;
    button.disabled = !!disabled;
    if (onClick) button.addEventListener("click", onClick);
    return button;
  }

  function startSipDistribution(total, sourceText) {
    if (!state.currentRoom) return;
    state.pendingSipDistribution = {
      total,
      sourceText,
      roomCode: state.currentRoom.code,
    };
  }

  function maybeShowIncomingNotification(room) {
    const notifications = room && room.state && room.state.notifications ? room.state.notifications : [];
    if (!notifications.length) return;
    const latest = notifications[0];
    if (!latest || latest.id === state.lastNotificationId || !els.modalRoot.classList.contains("hidden")) {
      return;
    }
    state.lastNotificationId = latest.id;
    showModal({
      eyebrow: "Korty",
      title: latest.title,
      text: latest.text,
      confirmLabel: "Oké",
      onConfirm: async () => {
        try {
          await apiAction("bus_ack_notification", {
            room: room.code,
            client_id: state.clientId,
            notification_id: latest.id,
          });
          state.currentRoom = await apiState();
          if (!els.roomScreen.classList.contains("hidden")) {
            renderCurrentRoom();
          } else {
            updateResumeCard();
          }
        } catch (error) {
          console.error(error);
        }
      },
    });
  }

  function renderSipDistributor(room, title) {
    if (!state.pendingSipDistribution || state.pendingSipDistribution.roomCode !== room.code) {
      return null;
    }

    const total = state.pendingSipDistribution.total;
    const otherPlayers = room.state.players.filter((player) => player.client_id !== state.clientId);
    if (!otherPlayers.length) {
      state.pendingSipDistribution = null;
      return null;
    }

    const box = document.createElement("div");
    box.className = "rule-card";
    box.innerHTML = `<span class="mini-label">Kortyok kiosztása</span><h3>${escapeHtml(title)}</h3><p class="helper">${escapeHtml(state.pendingSipDistribution.sourceText)} Pontosan ${total} kortyot ossz szét.</p>`;

    const form = document.createElement("div");
    form.className = "distribution-list";
    const inputs = [];

    otherPlayers.forEach((player) => {
      const row = document.createElement("label");
      row.className = "distribution-row";
      row.innerHTML = `
        <span>${escapeHtml(player.name)}</span>
      `;
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = String(total);
      input.step = "1";
      input.value = "0";
      row.appendChild(input);
      form.appendChild(row);
      inputs.push({ playerId: player.id, input, name: player.name });
    });
    box.appendChild(form);

    const footer = document.createElement("div");
    footer.className = "action-row";
    footer.appendChild(createButton("Kiosztás most", "accent", async () => {
      const allocations = inputs.map(({ playerId, input }) => ({
        player_id: playerId,
        sips: Number(input.value || 0),
      })).filter((item) => item.sips > 0);
      const totalAssigned = allocations.reduce((sum, item) => sum + item.sips, 0);
      if (totalAssigned !== total) {
        showModal({
          title: "Nem stimmel a kiosztás",
          text: `Pontosan ${total} kortyot kell kiosztanod.`,
        });
        return;
      }
      await apiAction("bus_distribute_sips", {
        room: room.code,
        client_id: state.clientId,
        total,
        allocations,
      });
      state.pendingSipDistribution = null;
      state.currentRoom = await apiState();
      renderCurrentRoom();
    }));
    footer.appendChild(createButton("Mégse", "secondary", () => {
      state.pendingSipDistribution = null;
      renderCurrentRoom();
    }));
    box.appendChild(footer);
    return box;
  }

  function openPlayerManager(room) {
    els.managerBody.innerHTML = "";
    els.managerEyebrow.textContent = room.game === "kings" ? "Kings Cup" : "Buszozás";
    els.managerTitle.textContent = "Játékosok kezelése";

    if (room.game === "kings") {
      const box = document.createElement("div");
      box.className = "manager-stack";

      if (room.state.solo_mode && isHost(room)) {
        const addRow = document.createElement("div");
        addRow.className = "join-row";
        const addInput = document.createElement("input");
        addInput.placeholder = "Új játékos neve";
        addRow.appendChild(addInput);
        addRow.appendChild(createButton("Hozzáadás", "primary", async () => {
          if (!addInput.value.trim()) return;
          await apiAction("kings_add_player", {
            room: room.code,
            client_id: state.clientId,
            name: addInput.value.trim(),
          });
          state.currentRoom = await apiState();
          closePlayerManager();
          renderCurrentRoom();
          openPlayerManager(state.currentRoom);
        }));
        box.appendChild(addRow);
      }

      const list = document.createElement("div");
      list.className = "manager-stack";
      room.state.players.forEach((player) => {
        const row = document.createElement("div");
        row.className = "manager-player-card";
        if (isHost(room)) {
          const input = document.createElement("input");
          input.value = player.name;
          row.appendChild(input);
          const actions = document.createElement("div");
          actions.className = "action-row";
          actions.appendChild(createButton("Mentés", "secondary", async () => {
            await apiAction("kings_update_player", {
              room: room.code,
              client_id: state.clientId,
              player_id: player.id,
              name: input.value.trim(),
            });
            state.currentRoom = await apiState();
            closePlayerManager();
            renderCurrentRoom();
            openPlayerManager(state.currentRoom);
          }));
          actions.appendChild(createButton("Törlés", "danger", async () => {
            await apiAction("kings_remove_player", {
              room: room.code,
              client_id: state.clientId,
              player_id: player.id,
            });
            state.currentRoom = await apiState();
            closePlayerManager();
            renderCurrentRoom();
            openPlayerManager(state.currentRoom);
          }));
          row.appendChild(actions);
        } else {
          row.innerHTML = `<strong>${escapeHtml(player.name)}</strong>`;
        }
        list.appendChild(row);
      });
      box.appendChild(list);
      els.managerBody.appendChild(box);
    } else {
      const box = document.createElement("div");
      box.className = "manager-stack";

      const myPlayer = ownPlayer(room);
      if (myPlayer) {
        const profile = document.createElement("div");
        profile.className = "manager-player-card";
        const nameInput = document.createElement("input");
        nameInput.value = state.deviceName || myPlayer.name || "";
        profile.appendChild(nameInput);
        const save = createButton("Saját név mentése", "secondary", async () => {
          saveDeviceProfile(nameInput.value.trim());
          await apiAction("update_bus_profile", {
            room: room.code,
            client_id: state.clientId,
            name: state.deviceName || "Játékos",
            avatar: state.deviceAvatar,
          });
          state.currentRoom = await apiState();
          closePlayerManager();
          renderCurrentRoom();
        });
        profile.appendChild(save);
        box.appendChild(profile);
      }

      const list = document.createElement("div");
      list.className = "manager-stack";
      room.state.players.forEach((player) => {
        const row = document.createElement("div");
        row.className = "manager-player-card";
        row.innerHTML = `<strong>${escapeHtml(player.name)}</strong><span class="helper">${player.hand_count} lap</span>`;
        list.appendChild(row);
      });
      box.appendChild(list);
      els.managerBody.appendChild(box);
    }

    els.managerRoot.classList.remove("hidden");
  }

  function renderCurrentRoom() {
    const room = state.currentRoom;
    if (!room) return;

    state.lastRenderedSignature = JSON.stringify(room);
    updateResumeCard();
    maybeShowIncomingNotification(room);
    els.roomTitle.textContent = room.game === "kings"
      ? (room.state && room.state.solo_mode ? "Kings Cup Singleplayer" : "Kings Cup Multiplayer")
      : "Buszozás Multiplayer";
    els.roomStatusText.textContent = room.state.status || "";
    els.roomCodeText.textContent = room.code;
    els.roomContent.innerHTML = "";

    if (room.game === "kings") {
      renderKingsRoomV2(room);
    } else {
      renderBusRoom(room);
    }
  }

  function renderKingsRoomV2(room) {
    const wrap = document.createElement("div");
    wrap.className = "kings-layout";
    const currentPlayer = room.state.current_player_index != null ? room.state.players[room.state.current_player_index] : null;
    const isCurrentKingsPlayer = !!(
      currentPlayer &&
      (currentPlayer.client_id ? currentPlayer.client_id === state.clientId : isHost(room))
    );

    const left = document.createElement("div");
    left.className = "card";
    left.innerHTML = `
      <span class="mini-label">${room.state.solo_mode ? "Singleplayer" : "Multiplayer"}</span>
      <h2>${room.state.solo_mode ? "Kings Cup Solo" : "Kings Cup Szoba"}</h2>
      <p class="helper">${room.state.players.length} játékos van bent. A névkezelés és a játékosok rendezése felugró ablakból történik.</p>
    `;
    left.appendChild(createButton("Játékosok kezelése", "secondary", () => openPlayerManager(room)));

    const summary = document.createElement("div");
    summary.className = "player-grid";
    const currentName = room.state.current_player_name || "—";
    summary.innerHTML = `
      <div class="tile"><span class="mini-label">Pakli</span><h3>${room.state.deck_count} lap maradt</h3></div>
      <div class="tile"><span class="mini-label">Következő</span><h3>${escapeHtml(currentName)}</h3></div>
    `;
    left.appendChild(summary);

    const right = document.createElement("div");
    right.className = "card";
    right.innerHTML = `<span class="mini-label">Játékállapot</span><h2>${room.state.started ? escapeHtml(currentName) : "Várakozás"}</h2><p class="helper">${escapeHtml(room.state.status)}</p>`;

    const buttons = document.createElement("div");
    buttons.className = "kings-actions";
    if (isHost(room) && !room.state.started) {
      buttons.appendChild(createButton("Játék indítása", "primary", async () => {
        await apiAction("kings_start", { room: room.code, client_id: state.clientId });
        state.currentRoom = await apiState();
        renderCurrentRoom();
      }, room.state.players.length < 2));
    }
    if (isHost(room) && room.state.started) {
      buttons.appendChild(createButton("Újrakezdés", "danger", () => {
        showModal({
          title: "Biztos újra akarod kezdeni?",
          text: "A játék visszalép a kezdő állapotba, ahol újra lehet csatlakozni és neveket rendezni.",
          confirmLabel: "Újrakezdem",
          cancelLabel: "Mégse",
          onConfirm: async () => {
            await apiAction("kings_restart", { room: room.code, client_id: state.clientId });
            state.currentRoom = await apiState();
            renderCurrentRoom();
          },
        });
      }));
    }
    buttons.appendChild(createButton("Lap húzása", "accent", async () => {
      await apiAction("kings_draw", { room: room.code, client_id: state.clientId });
      state.currentRoom = await apiState();
      renderCurrentRoom();
    }, !room.state.started || !isCurrentKingsPlayer));
    buttons.appendChild(createButton("Kör skippelése", "secondary", async () => {
      await apiAction("kings_skip", { room: room.code, client_id: state.clientId });
      state.currentRoom = await apiState();
      renderCurrentRoom();
    }, !room.state.started));
    right.appendChild(buttons);

    const glass = document.createElement("div");
    glass.className = "kings-cup-meter";
    glass.innerHTML = `
      <div class="kings-cup-copy">
        <span class="mini-label">Király pohár</span>
        <h3>${room.state.kings_drawn || 0} / 4 király</h3>
        <p class="helper">A pohár a negyedik királynál telik meg teljesen.</p>
      </div>
      <div class="cup-shell"><div class="cup-fill" style="height:${Math.min(100, ((room.state.kings_drawn || 0) / 4) * 100)}%"></div></div>
    `;
    right.appendChild(glass);

    if (room.state.last_card) {
      const card = room.state.last_card.card;
      const rule = room.state.last_card.rule;
      const tile = document.createElement("div");
      tile.className = "rule-card";
      tile.innerHTML = `
        <span class="mini-label">Utolsó húzás</span>
        <div class="playing-card ${card.color}" data-center="${card.rank}${card.suit}">
          <span class="card-rank">${card.rank}</span>
          <span class="card-suit">${card.suit}</span>
        </div>
        <h3>${escapeHtml(room.state.last_card.player_name)} • ${escapeHtml(rule.title)}</h3>
        <p class="helper">${escapeHtml(rule.text)}</p>
      `;
      right.appendChild(tile);
    }

    wrap.appendChild(left);
    wrap.appendChild(right);
    els.roomContent.appendChild(wrap);
  }

  function renderKingsRoom(room) {
    const wrap = document.createElement("div");
    wrap.className = "kings-layout";
    const currentPlayer = room.state.current_player_index != null ? room.state.players[room.state.current_player_index] : null;
    const isCurrentKingsPlayer = !!(currentPlayer && currentPlayer.client_id === state.clientId);

    const left = document.createElement("div");
    left.className = "card";
    left.innerHTML = `<span class="mini-label">Játékoslista</span><h2>Nevek kezelése</h2><p class="helper">Adj hozzá új nevet, módosítsd a meglévőket, vagy töröld a listából.</p>`;

    const addRow = document.createElement("div");
    addRow.className = "join-row";
    const addInput = document.createElement("input");
    addInput.placeholder = "Új játékos neve";
    addRow.appendChild(addInput);
    addRow.appendChild(createButton("Hozzáadás", "primary", async () => {
      if (!addInput.value.trim()) return;
      await apiAction("kings_add_player", {
        room: room.code,
        client_id: state.clientId,
        name: addInput.value.trim(),
      });
      state.currentRoom = await apiState();
      renderCurrentRoom();
    }));
    left.appendChild(addRow);
    if (!isHost(room)) {
      addRow.remove();
    }

    const roster = document.createElement("div");
    roster.className = "player-grid";
    room.state.players.forEach((player) => {
      const item = document.createElement("div");
      item.className = "player-card" + (room.state.current_player_name === player.name ? " current-turn" : "");
      const input = document.createElement("input");
      input.value = player.name;
      input.disabled = !isHost(room);
      item.appendChild(input);

      const actions = document.createElement("div");
      actions.className = "action-row";
      actions.appendChild(createButton("Mentés", "secondary", async () => {
        await apiAction("kings_update_player", {
          room: room.code,
          client_id: state.clientId,
          player_id: player.id,
          name: input.value.trim(),
        });
        state.currentRoom = await apiState();
        renderCurrentRoom();
      }));
      actions.appendChild(createButton("Törlés", "danger", async () => {
        await apiAction("kings_remove_player", {
          room: room.code,
          client_id: state.clientId,
          player_id: player.id,
        });
        state.currentRoom = await apiState();
        renderCurrentRoom();
      }));
      item.appendChild(actions);
      if (!isHost(room)) {
        actions.remove();
      }
      roster.appendChild(item);
    });
    left.appendChild(roster);

    const right = document.createElement("div");
    right.className = "card";
    right.innerHTML = `<span class="mini-label">Játékállapot</span><h2>${room.state.started ? escapeHtml(room.state.current_player_name || "Nincs játékos") : "Várakozás"}</h2><p class="helper">${escapeHtml(room.state.status)}</p>`;

    const buttons = document.createElement("div");
    buttons.className = "kings-actions";
    buttons.appendChild(createButton("Játék indítása", "primary", async () => {
      await apiAction("kings_start", { room: room.code, client_id: state.clientId });
      state.currentRoom = await apiState();
      renderCurrentRoom();
    }, room.state.players.length < 2));
    if (!isHost(room) && buttons.lastChild) {
      buttons.lastChild.remove();
    }
    buttons.appendChild(createButton("Lap húzása", "accent", async () => {
      await apiAction("kings_draw", { room: room.code, client_id: state.clientId });
      state.currentRoom = await apiState();
      renderCurrentRoom();
    }, !room.state.started || !isCurrentKingsPlayer));
    buttons.appendChild(createButton("Kör skippelése", "secondary", async () => {
      await apiAction("kings_skip", { room: room.code, client_id: state.clientId });
      state.currentRoom = await apiState();
      renderCurrentRoom();
    }, !room.state.started));
    right.appendChild(buttons);

    if (room.state.last_card) {
      const card = room.state.last_card.card;
      const rule = room.state.last_card.rule;
      const tile = document.createElement("div");
      tile.className = "rule-card";
      tile.innerHTML = `
        <span class="mini-label">Utolsó húzás</span>
        <div class="playing-card ${card.color}" data-center="${card.rank}${card.suit}">
          <span class="card-rank">${card.rank}</span>
          <span class="card-suit">${card.suit}</span>
        </div>
        <h3>${escapeHtml(room.state.last_card.player_name)} • ${escapeHtml(rule.title)}</h3>
        <p class="helper">${escapeHtml(rule.text)}</p>
      `;
      right.appendChild(tile);
    }

    const nextBox = document.createElement("div");
    nextBox.className = "tile";
    nextBox.innerHTML = `
      <span class="mini-label">Következő játékos</span>
      <h3>${escapeHtml(room.state.current_player_name || "—")}</h3>
      <p class="helper">Minden húzás után automatikusan a következő név jelenik meg.</p>
    `;
    right.appendChild(nextBox);

    wrap.appendChild(left);
    wrap.appendChild(right);
    els.roomContent.appendChild(wrap);
  }

  function busQuestionPrompt(myPlayer) {
    const step = (myPlayer && myPlayer.hand_count) || 0;
    if (myPlayer && myPlayer.completed_questions) {
      return "Kész vagy az első 5 kérdéssel.";
    }
    if (step === 0) return "Piros vagy fekete?";
    if (step === 1) return "Nagyobb vagy kisebb, mint az első lapod?";
    if (step === 2) return "Közte vagy kint?";
    if (step === 3) return "Melyik szín lesz a lap?";
    return "Mi lesz a pontos lap?";
  }

  function renderBusPlayers(room) {
    const wrap = document.createElement("div");
    wrap.className = "player-grid";
    room.state.players.forEach((player) => {
      const item = document.createElement("div");
      let extra = "";
      if (player.completed_questions) extra += " ready";
      if (player.is_bus_rider) extra += " bus-rider";
      item.className = "player-chip" + extra;
      item.innerHTML = `
        <div class="avatar-medium" style="${player.avatar ? `background-image:url(${escapeHtml(player.avatar)})` : ""}"></div>
        <div>
          <strong>${escapeHtml(player.name)}</strong>
          <div class="stat-row">
            <span class="pill">${player.hand_count} lap</span>
            ${player.completed_questions ? '<span class="pill">✓ 5 kérdés kész</span>' : ""}
            ${player.ready_for_next ? '<span class="pill">✓ okézta</span>' : ""}
            ${player.is_bus_rider ? '<span class="pill">Buszozó</span>' : ""}
            ${player.bus_done ? '<span class="pill">Végzett</span>' : ""}
          </div>
        </div>
      `;
      wrap.appendChild(item);
    });
    return wrap;
  }

  function renderHandCards(hand, lastRevealed, room) {
    const wrap = document.createElement("div");
    wrap.className = "hands-wrap";
    if (!hand.length) {
      const helper = document.createElement("p");
      helper.className = "helper";
      helper.textContent = "Nincs lap a kezedben.";
      wrap.appendChild(helper);
      return wrap;
    }

    hand.forEach((card) => {
      const playable = lastRevealed && card.rank === lastRevealed.rank;
      const el = document.createElement("div");
      el.className = "hand-card " + card.color + (playable ? " playable" : "");
      el.dataset.center = card.rank + card.suit;
      if (playable) {
        el.addEventListener("click", async () => {
          const result = await apiAction("bus_claim_match", {
            room: room.code,
            client_id: state.clientId,
            hand_card_id: card.id,
          });
          state.currentRoom = result.room;
          if (result.result && result.result.award_sips > 0) {
            startSipDistribution(result.result.award_sips, result.result.message);
          }
          renderCurrentRoom();
        });
      }
      wrap.appendChild(el);
    });
    return wrap;
  }

  function renderPyramid(room) {
    const grid = document.createElement("div");
    grid.className = "pyramid-grid";
    const pyramid = room.state.pyramid;
    let start = 0;

    for (let row = 5; row >= 1; row -= 1) {
      const label = document.createElement("div");
      label.className = "mini-label";
      label.textContent = `Sor ${6 - row} • ${6 - row} korty`;

      const rowEl = document.createElement("div");
      rowEl.className = "pyramid-row";
      for (let i = 0; i < row; i += 1) {
        const slot = pyramid[start + i];
        const slotEl = document.createElement("div");
        slotEl.className = "pyramid-slot";
        const badges = document.createElement("div");
        badges.className = "slot-badges";
        const cardEl = document.createElement("div");

        if (slot && slot.revealed && slot.card) {
          cardEl.className = "mini-card " + slot.card.color;
          cardEl.dataset.center = slot.card.rank + slot.card.suit;

          if (slot.placed_count > 0) {
            const stack = document.createElement("div");
            stack.className = "stack-badge";
            stack.textContent = "+" + slot.placed_count;
            badges.appendChild(stack);
          }
        } else {
          cardEl.className = "mini-card";
          cardEl.dataset.center = "?";
        }

        slotEl.appendChild(badges);
        slotEl.appendChild(cardEl);
        rowEl.appendChild(slotEl);
      }

      const section = document.createElement("div");
      section.className = "pyramid-grid";
      section.appendChild(label);
      section.appendChild(rowEl);
      grid.appendChild(section);
      start += row;
    }

    return grid;
  }

  function renderBusRoom(room) {
    const myPlayer = ownPlayer(room);
    const wrap = document.createElement("div");
    wrap.className = "bus-layout";
    const isPyramidPhase = room.state.phase === "pyramid";
    if (isPyramidPhase) wrap.classList.add("pyramid-stage");

    const left = document.createElement("div");
    left.className = "card";
    left.innerHTML = `<span class="mini-label">Játékosok</span><h2>Ki játszik?</h2><p class="helper">A saját nevedet és képedet a szoba elején bármikor frissítheted.</p>`;

    left.appendChild(createButton("Játékosok kezelése", "secondary", () => openPlayerManager(room)));
    const profileRow = document.createElement("div");
    profileRow.className = "profile-form";
    const nameInput = document.createElement("input");
    nameInput.value = state.deviceName || "";
    nameInput.placeholder = "Saját név";
    const avatarInput = document.createElement("input");
    avatarInput.type = "file";
    avatarInput.accept = "image/*";
    const avatarPreview = document.createElement("div");
    avatarPreview.className = "avatar-preview";
    setAvatarPreview(avatarPreview, state.deviceAvatar);
    avatarInput.addEventListener("change", async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        state.deviceAvatar = reader.result;
        setAvatarPreview(avatarPreview, state.deviceAvatar);
        saveDeviceProfile();
        if (state.currentRoom) {
          await apiAction("update_bus_profile", {
            room: room.code,
            client_id: state.clientId,
            name: nameInput.value.trim() || "Játékos",
            avatar: state.deviceAvatar,
          });
          state.currentRoom = await apiState();
          renderCurrentRoom();
        }
      };
      reader.readAsDataURL(file);
    });

    profileRow.appendChild(nameInput);
    profileRow.appendChild(avatarInput);
    profileRow.appendChild(avatarPreview);
    left.appendChild(profileRow);
    left.appendChild(createButton("Saját profil mentése", "secondary", async () => {
      saveDeviceProfile(nameInput.value.trim());
      await apiAction("update_bus_profile", {
        room: room.code,
        client_id: state.clientId,
        name: state.deviceName || "Játékos",
        avatar: state.deviceAvatar,
      });
      state.currentRoom = await apiState();
      renderCurrentRoom();
    }));

    const playerSection = document.createElement("div");
    playerSection.className = "tile";
    playerSection.innerHTML = `<span class="mini-label">Résztvevők</span><h3>${room.state.players.length} játékos</h3>`;
    playerSection.appendChild(renderBusPlayers(room));
    left.appendChild(playerSection);
    profileRow.remove();
    playerSection.remove();
    if (left.lastChild && left.lastChild.tagName === "BUTTON" && left.lastChild.textContent.indexOf("profil") !== -1) {
      left.lastChild.remove();
    }

    const handSection = document.createElement("div");
    handSection.className = isPyramidPhase ? "tile hand-tray" : "tile";
    handSection.innerHTML = `<span class="mini-label">Saját lapjaid</span><p class="helper">Te látod a saját lapjaidat, mások csak a darabszámot.</p>`;
    const lastRevealedIndex = room.state.last_revealed_index;
    const lastRevealed = lastRevealedIndex >= 0 ? room.state.pyramid[lastRevealedIndex]?.card : null;
    handSection.appendChild(renderHandCards(room.state.private_hand || [], lastRevealed, room));
    if (!isPyramidPhase) {
      left.appendChild(handSection);
    }

    const right = document.createElement("div");
    right.className = "card";

    if (room.state.phase === "lobby" || room.state.phase === "pyramid_refill") {
      const setup = document.createElement("div");
      setup.className = "question-card";
      setup.innerHTML = `
        <span class="mini-label">Beállítás</span>
        <h2>Buszozás indítás</h2>
        <p class="helper">A játékosok száma alapján javasolt pakliszám: ${room.state.recommended_decks}.</p>
      `;
      const deckRow = document.createElement("div");
      deckRow.className = "join-row";
      const deckSelect = document.createElement("select");
      for (let i = 1; i <= 8; i += 1) {
        const option = document.createElement("option");
        option.value = String(i);
        option.textContent = i + " pakli";
        option.selected = i === room.state.deck_setting;
        deckSelect.appendChild(option);
      }
      deckRow.appendChild(deckSelect);
      deckRow.appendChild(createButton("Pakliszám mentése", "secondary", async () => {
        await apiAction("set_bus_decks", {
          room: room.code,
          client_id: state.clientId,
          deck_count: Number(deckSelect.value),
        });
        state.currentRoom = await apiState();
        renderCurrentRoom();
      }));
      setup.appendChild(deckRow);
      setup.appendChild(createButton("Mindenki kész, indulhat", "primary", async () => {
        await apiAction("start_bus", { room: room.code, client_id: state.clientId });
        state.currentRoom = await apiState();
        renderCurrentRoom();
      }, room.state.players.length < 2));
      if (!isHost(room) && setup.lastChild) {
        setup.lastChild.remove();
      }
      right.appendChild(setup);

      if (room.state.refill_choice_needed) {
        const refill = document.createElement("div");
        refill.className = "rule-card";
        refill.innerHTML = `<span class="mini-label">Kevés a lap</span><h3>Piramis utántöltés kell</h3><p class="helper">A piramishoz már nincs elég maradék kártya.</p>`;
        const actions = document.createElement("div");
        actions.className = "action-row";
        actions.appendChild(createButton("Teljes új pakli bekeverése", "primary", async () => {
          await apiAction("choose_pyramid_refill", {
            room: room.code,
            client_id: state.clientId,
            mode: "full",
          });
          state.currentRoom = await apiState();
          renderCurrentRoom();
        }));
        actions.appendChild(createButton("Csak random feltöltés", "secondary", async () => {
          await apiAction("choose_pyramid_refill", {
            room: room.code,
            client_id: state.clientId,
            mode: "random",
          });
          state.currentRoom = await apiState();
          renderCurrentRoom();
        }));
        refill.appendChild(actions);
        right.appendChild(refill);
      }
    }

    if (room.state.phase === "questions") {
      const card = document.createElement("div");
      card.className = "question-card";
      card.innerHTML = `<span class="mini-label">Első 5 kérdés</span><h2>${escapeHtml(busQuestionPrompt(myPlayer || {}))}</h2><p class="helper">${myPlayer && myPlayer.completed_questions ? "Megvagy a saját 5 kérdéseddel. Várjuk a többieket." : "Minden válasz után a rendszer húz egy lapot neked a közös pakliból."}</p>`;

      if (!myPlayer || !myPlayer.completed_questions) {
        const step = (myPlayer && myPlayer.hand_count) || 0;
        const actions = document.createElement("div");
        actions.className = "question-actions";

        function addGuess(label, guess, className) {
          actions.appendChild(createButton(label, className, async () => {
            const result = await apiAction("bus_answer_question", {
              room: room.code,
              client_id: state.clientId,
              guess,
            });
            state.currentRoom = result.room;
            if (result.result && result.result.award_sips > 0) {
              startSipDistribution(result.result.award_sips, result.result.message);
            }
            showModal({
              eyebrow: "Húzás eredménye",
              title: result.result.card.rank + result.result.card.suit,
              text: result.result.message,
            });
            renderCurrentRoom();
          }));
        }

        if (step === 0) {
          addGuess("Piros", "red", "primary");
          addGuess("Fekete", "black", "secondary");
        } else if (step === 1) {
          addGuess("Nagyobb", "higher", "primary");
          addGuess("Kisebb", "lower", "secondary");
        } else if (step === 2) {
          addGuess("Közte", "inside", "primary");
          addGuess("Kint", "outside", "secondary");
        } else if (step === 3) {
          ["♥", "♦", "♠", "♣"].forEach((suit, index) => {
            addGuess(suit, suit, index < 2 ? "accent" : "secondary");
          });
        } else {
          const exactWrap = document.createElement("div");
          exactWrap.className = "join-row";
          const rankSelect = document.createElement("select");
          RANKS.forEach((rank) => {
            const option = document.createElement("option");
            option.value = rank;
            option.textContent = rank;
            rankSelect.appendChild(option);
          });
          const suitSelect = document.createElement("select");
          ["♥", "♦", "♠", "♣"].forEach((suit) => {
            const option = document.createElement("option");
            option.value = suit;
            option.textContent = suit;
            suitSelect.appendChild(option);
          });
          exactWrap.appendChild(rankSelect);
          exactWrap.appendChild(suitSelect);
          exactWrap.appendChild(createButton("Pontos tipp leadása", "accent", async () => {
            const result = await apiAction("bus_answer_question", {
              room: room.code,
              client_id: state.clientId,
              guess: { rank: rankSelect.value, suit: suitSelect.value },
            });
            state.currentRoom = result.room;
            if (result.result && result.result.award_sips > 0) {
              startSipDistribution(result.result.award_sips, result.result.message);
            }
            showModal({
              eyebrow: "Húzás eredménye",
              title: result.result.card.rank + result.result.card.suit,
              text: result.result.message,
            });
            renderCurrentRoom();
          }));
          card.appendChild(exactWrap);
        }

        if (step < 4) {
          card.appendChild(actions);
        }
      }
      const distributor = renderSipDistributor(room, "Kortyok kiosztása");
      if (distributor) {
        card.appendChild(distributor);
      }
      right.appendChild(card);
    }

    if (room.state.phase === "pyramid") {
      const pyramidCard = document.createElement("div");
      pyramidCard.className = "pyramid-card";
      pyramidCard.innerHTML = `<span class="mini-label">Piramis</span><h2>Közös piramis</h2><p class="helper">Ha a legutóbb felfordított lap értékével egyező lapod van, kattintással ráteheted.</p>`;

      const lastIndex = room.state.last_revealed_index;
      const lastCard = lastIndex >= 0 && room.state.pyramid[lastIndex] ? room.state.pyramid[lastIndex].card : null;
      if (lastCard) {
        const notice = document.createElement("div");
        notice.className = "highlight-box";
        notice.textContent = `Utolsó felfordított lap: ${lastCard.rank}${lastCard.suit}. Mindenki okézza le, mielőtt jön a következő lap.`;
        pyramidCard.appendChild(notice);
      }

      pyramidCard.appendChild(renderPyramid(room));

      const actions = document.createElement("div");
      actions.className = "action-row";
      const canReveal = room.state.last_revealed_index < 0 ||
        room.state.last_revealed_index >= 14 ||
        room.state.players.every((player) => player.ready_for_next);

      actions.appendChild(createButton("Leokézom a következő lapot", "secondary", async () => {
        await apiAction("bus_ready_next", { room: room.code, client_id: state.clientId });
        state.currentRoom = await apiState();
        renderCurrentRoom();
      }, myPlayer && myPlayer.ready_for_next));
      actions.appendChild(createButton(room.state.pyramid_index >= 15 ? "Buszozás indítása" : "Következő piramislap", "primary", async () => {
        await apiAction("bus_reveal_pyramid", { room: room.code, client_id: state.clientId });
        state.currentRoom = await apiState();
        renderCurrentRoom();
      }, !canReveal || !isHost(room)));
      pyramidCard.appendChild(actions);
      if (!isHost(room) && actions.lastChild) {
        actions.lastChild.remove();
      }
      if (!isHost(room)) {
        const hostHint = document.createElement("p");
        hostHint.className = "helper";
        hostHint.textContent = "A következő piramislapot csak a szoba létrehozója fordíthatja fel.";
        pyramidCard.appendChild(hostHint);
      }
      const distributor = renderSipDistributor(room, "Piramis kortyok");
      if (distributor) {
        pyramidCard.appendChild(distributor);
      }
      right.appendChild(pyramidCard);
      right.appendChild(handSection);
    }

    if (room.state.phase === "bus" || room.state.phase === "finished") {
      const busCard = document.createElement("div");
      busCard.className = "bus-card";

      const busState = room.state.bus_state;
      if (room.state.phase === "bus" && busState) {
        busCard.innerHTML = `<span class="mini-label">Buszozás</span><h2>${escapeHtml(busState.rider_name)} buszozik</h2><p class="helper">${escapeHtml(busState.last_message || "")}</p>`;

        const pair = document.createElement("div");
        pair.className = "card-pair";
        pair.innerHTML = `
          <div class="card-slot">
            <div class="mini-label">Előző lap</div>
            <div class="playing-card ${busState.previous_card ? busState.previous_card.color : "placeholder"}" data-center="${busState.previous_card ? busState.previous_card.rank + busState.previous_card.suit : "?"}">
              <span class="card-rank">${busState.previous_card ? busState.previous_card.rank : "?"}</span>
              <span class="card-suit">${busState.previous_card ? busState.previous_card.suit : "♠"}</span>
            </div>
          </div>
          <div class="card-slot">
            <div class="mini-label">Mostani lap</div>
            <div class="playing-card ${busState.current_card ? busState.current_card.color : "placeholder"}" data-center="${busState.current_card ? busState.current_card.rank + busState.current_card.suit : "?"}">
              <span class="card-rank">${busState.current_card ? busState.current_card.rank : "?"}</span>
              <span class="card-suit">${busState.current_card ? busState.current_card.suit : "♠"}</span>
            </div>
          </div>
        `;
        busCard.appendChild(pair);

        const rider = room.state.players.find((player) => player.id === busState.rider_id);
        const isRider = rider && rider.client_id === state.clientId;

        if (isRider) {
          const actions = document.createElement("div");
          actions.className = "bus-actions";
          ["higher", "same", "lower"].forEach((guess, index) => {
            const label = guess === "higher" ? "Nagyobb" : guess === "lower" ? "Kisebb" : "Ugyanaz";
            const klass = index === 0 ? "primary" : index === 1 ? "secondary" : "accent";
            actions.appendChild(createButton(label, klass, async () => {
              const result = await apiAction("bus_guess", {
                room: room.code,
                client_id: state.clientId,
                guess,
              });
              state.currentRoom = result.room;
              const freshRoom = state.currentRoom;
              const freshBusState = freshRoom.state.bus_state;
              const freshRider = freshRoom.state.players.find((player) => player.client_id === state.clientId);
              if (freshRoom.state.phase === "bus" && freshBusState && freshBusState.last_penalty > 0) {
                showModal({
                  eyebrow: "Igyál",
                  title: `${freshBusState.last_penalty} korty`,
                  text: `Ez a kör elment. Most ${freshBusState.last_penalty} korty jár.`,
                  confirmLabel: "Megittam",
                });
              } else if (freshRoom.state.phase === "finished" && freshRider) {
                showModal({
                  eyebrow: "Vége",
                  title: "Gratulálunk, öcsipók!",
                  text: `Sikerült megnyerni a buszozást. Mire nyertél, összesen ${freshRider.bus_total_sips} kortyot kellett innod.`,
                  confirmLabel: "Szép volt",
                });
              }
              renderCurrentRoom();
            }));
          });
          busCard.appendChild(actions);
        } else {
          const vote = document.createElement("div");
          vote.className = "vote-wrap";
          vote.appendChild(createButton("Szerintem nagyobb", "secondary", async () => {
            await apiAction("bus_vote", { room: room.code, client_id: state.clientId, vote: "higher" });
            state.currentRoom = await apiState();
            renderCurrentRoom();
          }));
          vote.appendChild(createButton("Szerintem kisebb", "secondary", async () => {
            await apiAction("bus_vote", { room: room.code, client_id: state.clientId, vote: "lower" });
            state.currentRoom = await apiState();
            renderCurrentRoom();
          }));
          busCard.appendChild(vote);
        }

        const votes = document.createElement("div");
        votes.className = "observer-votes";
        Object.entries(busState.observer_votes || {}).forEach(([playerId, vote]) => {
          const voter = room.state.players.find((player) => player.id === playerId);
          if (!voter) return;
          const el = document.createElement("span");
          el.className = "vote-pill";
          el.textContent = `${voter.name}: ${vote === "higher" ? "nagyobb" : "kisebb"}`;
          votes.appendChild(el);
        });
        if (votes.childNodes.length) {
          busCard.appendChild(votes);
        }
      } else {
        const riders = room.state.players.filter((player) => player.is_bus_rider);
        busCard.innerHTML = `<span class="mini-label">Buszozás vége</span><h2>Lezárult a játék</h2><p class="helper">${riders.length ? "Buszozók voltak: " + riders.map((r) => r.name).join(", ") : "Nem maradt buszozó."}</p>`;
      }

      right.appendChild(busCard);
    }

    wrap.appendChild(left);
    wrap.appendChild(right);
    els.roomContent.appendChild(wrap);
  }

  function renderSipDistributor(room, title) {
    if (!state.pendingSipDistribution || state.pendingSipDistribution.roomCode !== room.code) {
      return null;
    }

    const total = state.pendingSipDistribution.total;
    const otherPlayers = room.state.players.filter((player) => player.client_id !== state.clientId);
    if (!otherPlayers.length) {
      state.pendingSipDistribution = null;
      return null;
    }

    const box = document.createElement("div");
    box.className = "rule-card";
    box.innerHTML = `<span class="mini-label">Kortyok kiosztása</span><h3>${escapeHtml(title)}</h3><p class="helper">${escapeHtml(state.pendingSipDistribution.sourceText)} Pontosan ${total} kortyot ossz szét.</p>`;

    const summary = document.createElement("div");
    summary.className = "distribution-summary";
    box.appendChild(summary);

    const form = document.createElement("div");
    form.className = "distribution-list";
    const allocations = [];
    let remaining = total;

    function updateDistributionSummary() {
      summary.innerHTML = `
        <span class="pill">Még kiosztható: ${remaining}</span>
        <span class="pill">Összesen: ${total}</span>
      `;
      allocations.forEach((entry) => {
        entry.amountEl.textContent = String(entry.value);
        entry.plusBtn.disabled = remaining <= 0;
        entry.minusBtn.disabled = entry.value <= 0;
      });
    }

    otherPlayers.forEach((player) => {
      const row = document.createElement("div");
      row.className = "distribution-row";

      const info = document.createElement("div");
      info.className = "distribution-player";
      info.innerHTML = `
        <div class="avatar-small" style="${player.avatar ? `background-image:url(${player.avatar})` : ""}"></div>
        <div>
          <strong>${escapeHtml(player.name)}</strong>
          <div class="helper">Koppints, és oszd szét a kortyokat.</div>
        </div>
      `;

      const controls = document.createElement("div");
      controls.className = "distribution-controls";
      const amountEl = document.createElement("div");
      amountEl.className = "distribution-amount";
      amountEl.textContent = "0";

      const entry = {
        playerId: player.id,
        value: 0,
        amountEl,
        plusBtn: null,
        minusBtn: null,
      };

      const minusBtn = createButton("-", "secondary icon-button", () => {
        if (entry.value <= 0) return;
        entry.value -= 1;
        remaining += 1;
        updateDistributionSummary();
      });
      const plusBtn = createButton("+", "accent icon-button", () => {
        if (remaining <= 0) return;
        entry.value += 1;
        remaining -= 1;
        updateDistributionSummary();
      });

      entry.plusBtn = plusBtn;
      entry.minusBtn = minusBtn;
      controls.appendChild(minusBtn);
      controls.appendChild(amountEl);
      controls.appendChild(plusBtn);
      row.appendChild(info);
      row.appendChild(controls);
      form.appendChild(row);
      allocations.push(entry);
    });
    box.appendChild(form);
    updateDistributionSummary();

    const footer = document.createElement("div");
    footer.className = "action-row";
    footer.appendChild(createButton("Kiosztás most", "accent", async () => {
      const payloadAllocations = allocations.map((entry) => ({
        player_id: entry.playerId,
        sips: entry.value,
      })).filter((item) => item.sips > 0);
      const totalAssigned = payloadAllocations.reduce((sum, item) => sum + item.sips, 0);
      if (totalAssigned !== total) {
        showModal({
          title: "Nem stimmel a kiosztás",
          text: `Pontosan ${total} kortyot kell kiosztanod.`,
        });
        return;
      }
      await apiAction("bus_distribute_sips", {
        room: room.code,
        client_id: state.clientId,
        total,
        allocations: payloadAllocations,
      });
      state.pendingSipDistribution = null;
      state.currentRoom = await apiState();
      renderCurrentRoom();
    }));
    footer.appendChild(createButton("Mégse", "secondary", () => {
      state.pendingSipDistribution = null;
      renderCurrentRoom();
    }));
    box.appendChild(footer);
    return box;
  }

  function roomPhaseLabel(room) {
    if (room.game === "kings") return room.state.started ? "Kings Cup" : "Lobby";
    if (room.state.phase === "lobby") return "Lobby";
    if (room.state.phase === "questions") return "Első 5 kérdés";
    if (room.state.phase === "pyramid") return "Piramis";
    if (room.state.phase === "bus") return "Buszozás";
    if (room.state.phase === "finished") return "Vége";
    return "Játék";
  }

  function roomCurrentActor(room) {
    if (room.game === "kings") return room.state.current_player_name || "Várakozás";
    if (room.state.phase === "bus" && room.state.bus_state) return room.state.bus_state.rider_name || "Buszozó";
    const myPlayer = ownPlayer(room);
    if (room.state.phase === "questions") return myPlayer && !myPlayer.completed_questions ? (myPlayer.name || "Te") : "Mindenki válaszol";
    if (room.state.phase === "pyramid") return isHost(room) ? "Host fordít" : "Hostra vártok";
    return "Közös játék";
  }

  function roomSecondarySummary(room) {
    if (room.game === "kings") return `${room.state.deck_count} lap maradt`;
    if (room.state.phase === "questions") {
      const myPlayer = ownPlayer(room);
      return `${myPlayer ? myPlayer.hand_count : 0}/5 lap nálad`;
    }
    if (room.state.phase === "pyramid") return `${Math.min(room.state.pyramid_index || 0, 15)}/15 piramislap`;
    if (room.state.phase === "bus" && room.state.bus_state) return `${room.state.bus_state.correct_streak || 0}/5 jó tipp`;
    return `${room.state.players.length} játékos`;
  }

  function renderCompactRoster(room) {
    const roster = document.createElement("div");
    roster.className = "player-roster";
    room.state.players.forEach((player) => {
      const chip = document.createElement("div");
      let extra = "";
      if (room.game === "kings" && room.state.current_player_name === player.name) extra += " current-turn";
      if (room.game === "bus" && player.completed_questions) extra += " ready";
      if (room.game === "bus" && player.is_bus_rider) extra += " bus-rider";
      chip.className = "player-chip compact" + extra;

      const meta = [];
      if (room.game === "kings") {
        meta.push(room.state.current_player_name === player.name ? "most jön" : "vár");
      } else {
        meta.push(`${player.hand_count} lap`);
        if (player.completed_questions) meta.push("kész");
        if (player.ready_for_next) meta.push("okézta");
        if (player.is_bus_rider) meta.push("buszozó");
        if (player.bus_done) meta.push("végzett");
      }

      chip.innerHTML = `
        <div class="avatar-small" style="${player.avatar ? `background-image:url(${player.avatar})` : ""}"></div>
        <div class="player-chip-copy">
          <strong>${escapeHtml(player.name)}</strong>
          <span class="player-chip-meta">${escapeHtml(meta.join(" • "))}</span>
        </div>
      `;
      roster.appendChild(chip);
    });
    return roster;
  }

  function renderRoomStatusBar(room) {
    const bar = document.createElement("div");
    bar.className = "room-status-bar";
    bar.innerHTML = `
      <div class="status-pill">
        <span class="mini-label">Fázis</span>
        <strong>${escapeHtml(roomPhaseLabel(room))}</strong>
      </div>
      <div class="status-pill">
        <span class="mini-label">${room.game === "kings" ? "Következő" : "Aktív"}</span>
        <strong>${escapeHtml(roomCurrentActor(room))}</strong>
      </div>
      <div class="status-pill">
        <span class="mini-label">Infó</span>
        <strong>${escapeHtml(roomSecondarySummary(room))}</strong>
      </div>
    `;
    return bar;
  }

  function renderRoomQuickbar(room) {
    if (room.game === "bus" && room.state.phase === "pyramid") return null;
    const bar = document.createElement("div");
    bar.className = "mobile-room-quickbar";
    bar.appendChild(createButton("Menü", "secondary", () => setLobbyVisible(true)));
    bar.appendChild(createButton("Játékosok", "secondary", () => openPlayerManager(room)));
    bar.appendChild(createButton("Kilépés", "danger", () => {
      showModal({
        title: "Biztosan kilépsz?",
        text: "Kilépés után kiveszünk a játékoslistából, és ezt a többiek is látni fogják.",
        confirmLabel: "Kilépek",
        cancelLabel: "Maradok",
        onConfirm: async () => {
          await leaveCurrentRoom();
        },
      });
    }));
    return bar;
  }

  function renderCurrentRoom() {
    const room = state.currentRoom;
    if (!room) return;

    state.lastRenderedSignature = JSON.stringify(room);
    updateResumeCard();
    maybeShowIncomingNotification(room);
    els.roomTitle.textContent = room.game === "kings"
      ? (room.state && room.state.solo_mode ? "Kings Cup Singleplayer" : "Kings Cup Multiplayer")
      : "Buszozás Multiplayer";
    els.roomStatusText.textContent = room.state.status || "";
    els.roomCodeText.textContent = room.code;
    els.roomContent.innerHTML = "";
    els.roomContent.appendChild(renderRoomStatusBar(room));

    if (room.game === "kings") {
      renderKingsRoomV2(room);
    } else {
      renderBusRoom(room);
    }

    const quickbar = renderRoomQuickbar(room);
    if (quickbar) {
      els.roomContent.appendChild(quickbar);
    }
  }

  function renderKingsRoomV2(room) {
    const wrap = document.createElement("div");
    wrap.className = "kings-layout";
    const currentPlayer = room.state.current_player_index != null ? room.state.players[room.state.current_player_index] : null;
    const isCurrentKingsPlayer = !!(
      currentPlayer &&
      (currentPlayer.client_id ? currentPlayer.client_id === state.clientId : isHost(room))
    );

    const left = document.createElement("div");
    left.className = "card";
    left.innerHTML = `
      <span class="mini-label">${room.state.solo_mode ? "Singleplayer" : "Multiplayer"}</span>
      <h2>${room.state.solo_mode ? "Kings Cup Solo" : "Kings Cup Szoba"}</h2>
      <p class="helper">${room.state.players.length} játékos van bent. A fontos kezelők külön ablakban nyílnak meg, így telefonon is tisztább marad a nézet.</p>
    `;
    left.appendChild(createButton("Játékosok kezelése", "secondary", () => openPlayerManager(room)));

    const rosterCard = document.createElement("div");
    rosterCard.className = "tile";
    rosterCard.innerHTML = `<span class="mini-label">Játékosok</span><h3>Aktív sorrend</h3>`;
    rosterCard.appendChild(renderCompactRoster(room));
    left.appendChild(rosterCard);

    const summary = document.createElement("div");
    summary.className = "player-grid";
    const currentName = room.state.current_player_name || "—";
    summary.innerHTML = `
      <div class="tile"><span class="mini-label">Pakli</span><h3>${room.state.deck_count} lap maradt</h3></div>
      <div class="tile"><span class="mini-label">Következő</span><h3>${escapeHtml(currentName)}</h3></div>
    `;
    left.appendChild(summary);

    const right = document.createElement("div");
    right.className = "card";
    right.innerHTML = `<span class="mini-label">Játékállapot</span><h2>${room.state.started ? escapeHtml(currentName) : "Várakozás"}</h2><p class="helper">${escapeHtml(room.state.status)}</p>`;

    const buttons = document.createElement("div");
    buttons.className = "kings-actions";
    if (isHost(room) && !room.state.started) {
      buttons.appendChild(createButton("Játék indítása", "primary", async () => {
        await apiAction("kings_start", { room: room.code, client_id: state.clientId });
        state.currentRoom = await apiState();
        renderCurrentRoom();
      }, room.state.players.length < 2));
    }
    if (isHost(room) && room.state.started) {
      buttons.appendChild(createButton("Újrakezdés", "danger", () => {
        showModal({
          title: "Biztos újra akarod kezdeni?",
          text: "A játék visszalép a kezdő állapotba, ahol újra lehet csatlakozni és neveket rendezni.",
          confirmLabel: "Újrakezdem",
          cancelLabel: "Mégse",
          onConfirm: async () => {
            await apiAction("kings_restart", { room: room.code, client_id: state.clientId });
            state.currentRoom = await apiState();
            renderCurrentRoom();
          },
        });
      }));
    }
    buttons.appendChild(createButton("Lap húzása", "accent", async () => {
      await apiAction("kings_draw", { room: room.code, client_id: state.clientId });
      state.currentRoom = await apiState();
      renderCurrentRoom();
    }, !room.state.started || !isCurrentKingsPlayer));
    buttons.appendChild(createButton("Kör skippelése", "secondary", async () => {
      await apiAction("kings_skip", { room: room.code, client_id: state.clientId });
      state.currentRoom = await apiState();
      renderCurrentRoom();
    }, !room.state.started));
    right.appendChild(buttons);

    const glass = document.createElement("div");
    glass.className = "kings-cup-meter";
    glass.innerHTML = `
      <div class="kings-cup-copy">
        <span class="mini-label">Király pohár</span>
        <h3>${room.state.kings_drawn || 0} / 4 király</h3>
        <p class="helper">A pohár a negyedik királynál telik meg teljesen.</p>
      </div>
      <div class="cup-shell"><div class="cup-fill" style="height:${Math.min(100, ((room.state.kings_drawn || 0) / 4) * 100)}%"></div></div>
    `;
    right.appendChild(glass);

    if (room.state.last_card) {
      const card = room.state.last_card.card;
      const rule = room.state.last_card.rule;
      const tile = document.createElement("div");
      tile.className = "rule-card";
      tile.innerHTML = `
        <span class="mini-label">Utolsó húzás</span>
        <div class="playing-card ${card.color}" data-center="${card.rank}${card.suit}">
          <span class="card-rank">${card.rank}</span>
          <span class="card-suit">${card.suit}</span>
        </div>
        <h3>${escapeHtml(room.state.last_card.player_name)} • ${escapeHtml(rule.title)}</h3>
        <p class="helper">${escapeHtml(rule.text)}</p>
      `;
      right.appendChild(tile);
    }

    wrap.appendChild(left);
    wrap.appendChild(right);
    els.roomContent.appendChild(wrap);
  }

  function renderBusPlayers(room) {
    return renderCompactRoster(room);
  }

  function renderBusRoom(room) {
    const myPlayer = ownPlayer(room);
    const wrap = document.createElement("div");
    wrap.className = "bus-layout";
    const isPyramidPhase = room.state.phase === "pyramid";
    if (isPyramidPhase) wrap.classList.add("pyramid-stage");

    const left = document.createElement("div");
    left.className = "card";
    left.innerHTML = `<span class="mini-label">Játékosok</span><h2>Ki játszik?</h2><p class="helper">A saját profilod és a teljes játékoslista külön kezelőablakban nyílik meg, így marad hely a játéknak.</p>`;
    left.appendChild(createButton("Játékosok kezelése", "secondary", () => openPlayerManager(room)));

    const playerSection = document.createElement("div");
    playerSection.className = "tile";
    playerSection.innerHTML = `<span class="mini-label">Résztvevők</span><h3>${room.state.players.length} játékos</h3>`;
    playerSection.appendChild(renderBusPlayers(room));
    left.appendChild(playerSection);

    const handSection = document.createElement("div");
    handSection.className = isPyramidPhase ? "tile hand-tray" : "tile";
    handSection.innerHTML = `<span class="mini-label">Saját lapjaid</span><p class="helper">Te látod a saját lapjaidat, mások csak a darabszámot.</p>`;
    const lastRevealedIndex = room.state.last_revealed_index;
    const lastRevealed = lastRevealedIndex >= 0 ? room.state.pyramid[lastRevealedIndex]?.card : null;
    handSection.appendChild(renderHandCards(room.state.private_hand || [], lastRevealed, room));
    if (!isPyramidPhase) {
      left.appendChild(handSection);
    }

    const right = document.createElement("div");
    right.className = "card";

    if (room.state.phase === "lobby" || room.state.phase === "pyramid_refill") {
      const setup = document.createElement("div");
      setup.className = "question-card";
      setup.innerHTML = `
        <span class="mini-label">Beállítás</span>
        <h2>Buszozás indítás</h2>
        <p class="helper">A játékosok száma alapján javasolt pakliszám: ${room.state.recommended_decks}.</p>
      `;
      const deckRow = document.createElement("div");
      deckRow.className = "join-row";
      const deckSelect = document.createElement("select");
      for (let i = 1; i <= 8; i += 1) {
        const option = document.createElement("option");
        option.value = String(i);
        option.textContent = i + " pakli";
        option.selected = i === room.state.deck_setting;
        deckSelect.appendChild(option);
      }
      deckRow.appendChild(deckSelect);
      deckRow.appendChild(createButton("Pakliszám mentése", "secondary", async () => {
        await apiAction("set_bus_decks", {
          room: room.code,
          client_id: state.clientId,
          deck_count: Number(deckSelect.value),
        });
        state.currentRoom = await apiState();
        renderCurrentRoom();
      }));
      setup.appendChild(deckRow);
      if (isHost(room)) {
        setup.appendChild(createButton("Mindenki kész, indulhat", "primary", async () => {
          await apiAction("start_bus", { room: room.code, client_id: state.clientId });
          state.currentRoom = await apiState();
          renderCurrentRoom();
        }, room.state.players.length < 2));
      }
      right.appendChild(setup);

      if (room.state.refill_choice_needed) {
        const refill = document.createElement("div");
        refill.className = "rule-card";
        refill.innerHTML = `<span class="mini-label">Kevés a lap</span><h3>Piramis utántöltés kell</h3><p class="helper">A piramishoz már nincs elég maradék kártya.</p>`;
        const actions = document.createElement("div");
        actions.className = "action-row";
        actions.appendChild(createButton("Teljes új pakli bekeverése", "primary", async () => {
          await apiAction("choose_pyramid_refill", {
            room: room.code,
            client_id: state.clientId,
            mode: "full",
          });
          state.currentRoom = await apiState();
          renderCurrentRoom();
        }));
        actions.appendChild(createButton("Csak random feltöltés", "secondary", async () => {
          await apiAction("choose_pyramid_refill", {
            room: room.code,
            client_id: state.clientId,
            mode: "random",
          });
          state.currentRoom = await apiState();
          renderCurrentRoom();
        }));
        refill.appendChild(actions);
        right.appendChild(refill);
      }
    }

    if (room.state.phase === "questions") {
      const card = document.createElement("div");
      card.className = "question-card";
      card.innerHTML = `<span class="mini-label">Első 5 kérdés</span><h2>${escapeHtml(busQuestionPrompt(myPlayer || {}))}</h2><p class="helper">${myPlayer && myPlayer.completed_questions ? "Megvagy a saját 5 kérdéseddel. Várjuk a többieket." : "Minden válasz után a rendszer húz egy lapot neked a közös pakliból."}</p>`;

      if (!myPlayer || !myPlayer.completed_questions) {
        const step = (myPlayer && myPlayer.hand_count) || 0;
        const actions = document.createElement("div");
        actions.className = "question-actions";

        function addGuess(label, guess, className) {
          actions.appendChild(createButton(label, className, async () => {
            const result = await apiAction("bus_answer_question", {
              room: room.code,
              client_id: state.clientId,
              guess,
            });
            state.currentRoom = result.room;
            if (result.result && result.result.award_sips > 0) {
              startSipDistribution(result.result.award_sips, result.result.message);
            }
            showModal({
              eyebrow: "Húzás eredménye",
              title: result.result.card.rank + result.result.card.suit,
              text: result.result.message,
            });
            renderCurrentRoom();
          }));
        }

        if (step === 0) {
          addGuess("Piros", "red", "primary");
          addGuess("Fekete", "black", "secondary");
        } else if (step === 1) {
          addGuess("Nagyobb", "higher", "primary");
          addGuess("Kisebb", "lower", "secondary");
        } else if (step === 2) {
          addGuess("Közte", "inside", "primary");
          addGuess("Kint", "outside", "secondary");
        } else if (step === 3) {
          ["♥", "♦", "♠", "♣"].forEach((suit, index) => {
            addGuess(suit, suit, index < 2 ? "accent" : "secondary");
          });
        } else {
          const exactWrap = document.createElement("div");
          exactWrap.className = "join-row";
          const rankSelect = document.createElement("select");
          RANKS.forEach((rank) => {
            const option = document.createElement("option");
            option.value = rank;
            option.textContent = rank;
            rankSelect.appendChild(option);
          });
          const suitSelect = document.createElement("select");
          ["♥", "♦", "♠", "♣"].forEach((suit) => {
            const option = document.createElement("option");
            option.value = suit;
            option.textContent = suit;
            suitSelect.appendChild(option);
          });
          exactWrap.appendChild(rankSelect);
          exactWrap.appendChild(suitSelect);
          exactWrap.appendChild(createButton("Pontos tipp leadása", "accent", async () => {
            const result = await apiAction("bus_answer_question", {
              room: room.code,
              client_id: state.clientId,
              guess: { rank: rankSelect.value, suit: suitSelect.value },
            });
            state.currentRoom = result.room;
            if (result.result && result.result.award_sips > 0) {
              startSipDistribution(result.result.award_sips, result.result.message);
            }
            showModal({
              eyebrow: "Húzás eredménye",
              title: result.result.card.rank + result.result.card.suit,
              text: result.result.message,
            });
            renderCurrentRoom();
          }));
          card.appendChild(exactWrap);
        }

        if (step < 4) {
          card.appendChild(actions);
        }
      }
      const distributor = renderSipDistributor(room, "Kortyok kiosztása");
      if (distributor) {
        card.appendChild(distributor);
      }
      right.appendChild(card);
    }

    if (room.state.phase === "pyramid") {
      const pyramidCard = document.createElement("div");
      pyramidCard.className = "pyramid-card";
      pyramidCard.innerHTML = `<span class="mini-label">Piramis</span><h2>Közös piramis</h2><p class="helper">Ha a legutóbb felfordított lap értékével egyező lapod van, kattintással ráteheted.</p>`;

      const lastIndex = room.state.last_revealed_index;
      const lastCard = lastIndex >= 0 && room.state.pyramid[lastIndex] ? room.state.pyramid[lastIndex].card : null;
      if (lastCard) {
        const notice = document.createElement("div");
        notice.className = "highlight-box";
        notice.textContent = `Utolsó felfordított lap: ${lastCard.rank}${lastCard.suit}. Mindenki okézza le, mielőtt jön a következő lap.`;
        pyramidCard.appendChild(notice);
      }

      pyramidCard.appendChild(renderPyramid(room));

      const actions = document.createElement("div");
      actions.className = "action-row";
      const canReveal = room.state.last_revealed_index < 0 ||
        room.state.last_revealed_index >= 14 ||
        room.state.players.every((player) => player.ready_for_next);

      actions.appendChild(createButton("Leokézom a következő lapot", "secondary", async () => {
        await apiAction("bus_ready_next", { room: room.code, client_id: state.clientId });
        state.currentRoom = await apiState();
        renderCurrentRoom();
      }, myPlayer && myPlayer.ready_for_next));
      if (isHost(room)) {
        actions.appendChild(createButton(room.state.pyramid_index >= 15 ? "Buszozás indítása" : "Következő piramislap", "primary", async () => {
          await apiAction("bus_reveal_pyramid", { room: room.code, client_id: state.clientId });
          state.currentRoom = await apiState();
          renderCurrentRoom();
        }, !canReveal));
      }
      pyramidCard.appendChild(actions);

      if (!isHost(room)) {
        const hostHint = document.createElement("p");
        hostHint.className = "helper";
        hostHint.textContent = "A következő piramislapot csak a szoba létrehozója fordíthatja fel.";
        pyramidCard.appendChild(hostHint);
      }

      const distributor = renderSipDistributor(room, "Piramis kortyok");
      if (distributor) {
        pyramidCard.appendChild(distributor);
      }
      right.appendChild(pyramidCard);
      right.appendChild(handSection);
    }

    if (room.state.phase === "bus" || room.state.phase === "finished") {
      const busCard = document.createElement("div");
      busCard.className = "bus-card";

      const busState = room.state.bus_state;
      if (room.state.phase === "bus" && busState) {
        busCard.innerHTML = `<span class="mini-label">Buszozás</span><h2>${escapeHtml(busState.rider_name)} buszozik</h2><p class="helper">${escapeHtml(busState.last_message || "")}</p>`;

        const pair = document.createElement("div");
        pair.className = "card-pair";
        pair.innerHTML = `
          <div class="card-slot">
            <div class="mini-label">Előző lap</div>
            <div class="playing-card ${busState.previous_card ? busState.previous_card.color : "placeholder"}" data-center="${busState.previous_card ? busState.previous_card.rank + busState.previous_card.suit : "?"}">
              <span class="card-rank">${busState.previous_card ? busState.previous_card.rank : "?"}</span>
              <span class="card-suit">${busState.previous_card ? busState.previous_card.suit : "♠"}</span>
            </div>
          </div>
          <div class="card-slot">
            <div class="mini-label">Mostani lap</div>
            <div class="playing-card ${busState.current_card ? busState.current_card.color : "placeholder"}" data-center="${busState.current_card ? busState.current_card.rank + busState.current_card.suit : "?"}">
              <span class="card-rank">${busState.current_card ? busState.current_card.rank : "?"}</span>
              <span class="card-suit">${busState.current_card ? busState.current_card.suit : "♠"}</span>
            </div>
          </div>
        `;
        busCard.appendChild(pair);

        const rider = room.state.players.find((player) => player.id === busState.rider_id);
        const isRider = rider && rider.client_id === state.clientId;

        if (isRider) {
          const actions = document.createElement("div");
          actions.className = "bus-actions";
          ["higher", "same", "lower"].forEach((guess, index) => {
            const label = guess === "higher" ? "Nagyobb" : guess === "lower" ? "Kisebb" : "Ugyanaz";
            const klass = index === 0 ? "primary" : index === 1 ? "secondary" : "accent";
            actions.appendChild(createButton(label, klass, async () => {
              const result = await apiAction("bus_guess", {
                room: room.code,
                client_id: state.clientId,
                guess,
              });
              state.currentRoom = result.room;
              const freshRoom = state.currentRoom;
              const freshBusState = freshRoom.state.bus_state;
              const freshRider = freshRoom.state.players.find((player) => player.client_id === state.clientId);
              if (freshRoom.state.phase === "bus" && freshBusState && freshBusState.last_penalty > 0) {
                showModal({
                  eyebrow: "Igyál",
                  title: `${freshBusState.last_penalty} korty`,
                  text: `Ez a kör elment. Most ${freshBusState.last_penalty} korty jár.`,
                  confirmLabel: "Megittam",
                });
              } else if (freshRoom.state.phase === "finished" && freshRider) {
                showModal({
                  eyebrow: "Vége",
                  title: "Gratulálunk, öcsipók!",
                  text: `Sikerült megnyerni a buszozást. Mire nyertél, összesen ${freshRider.bus_total_sips} kortyot kellett innod.`,
                  confirmLabel: "Szép volt",
                });
              }
              renderCurrentRoom();
            }));
          });
          busCard.appendChild(actions);
        } else {
          const vote = document.createElement("div");
          vote.className = "vote-wrap";
          vote.appendChild(createButton("Szerintem nagyobb", "secondary", async () => {
            await apiAction("bus_vote", { room: room.code, client_id: state.clientId, vote: "higher" });
            state.currentRoom = await apiState();
            renderCurrentRoom();
          }));
          vote.appendChild(createButton("Szerintem kisebb", "secondary", async () => {
            await apiAction("bus_vote", { room: room.code, client_id: state.clientId, vote: "lower" });
            state.currentRoom = await apiState();
            renderCurrentRoom();
          }));
          busCard.appendChild(vote);
        }

        const votes = document.createElement("div");
        votes.className = "observer-votes";
        Object.entries(busState.observer_votes || {}).forEach(([playerId, vote]) => {
          const voter = room.state.players.find((player) => player.id === playerId);
          if (!voter) return;
          const el = document.createElement("span");
          el.className = "vote-pill";
          el.textContent = `${voter.name}: ${vote === "higher" ? "nagyobb" : "kisebb"}`;
          votes.appendChild(el);
        });
        if (votes.childNodes.length) {
          busCard.appendChild(votes);
        }
      } else {
        const riders = room.state.players.filter((player) => player.is_bus_rider);
        busCard.innerHTML = `<span class="mini-label">Buszozás vége</span><h2>Lezárult a játék</h2><p class="helper">${riders.length ? "Buszozók voltak: " + riders.map((r) => r.name).join(", ") : "Nem maradt buszozó."}</p>`;
      }

      right.appendChild(busCard);
    }

    wrap.appendChild(left);
    wrap.appendChild(right);
    els.roomContent.appendChild(wrap);
  }

  els.deviceNameInput.value = state.deviceName;
  setAvatarPreview(els.deviceAvatarPreview, state.deviceAvatar);

  els.deviceAvatarInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.deviceAvatar = reader.result;
      setAvatarPreview(els.deviceAvatarPreview, state.deviceAvatar);
      saveDeviceProfile();
    };
    reader.readAsDataURL(file);
  });

  document.querySelectorAll("[data-create-room]").forEach((button) => {
    button.addEventListener("click", () => {
      createRoom(button.dataset.createRoom).catch((error) => {
        showModal({ title: "Nem sikerült létrehozni a szobát", text: error.message });
      });
    });
  });

  els.openFelesesBtn.addEventListener("click", openFelesesWindow);
  els.openFelesesRoomBtn.addEventListener("click", openFelesesWindow);
  els.backToMenuBtn.addEventListener("click", () => {
    setLobbyVisible(true);
  });
  els.leaveRoomBtn.addEventListener("click", () => {
    showModal({
      title: "Biztosan kilépsz?",
      text: "Kilépés után kiveszünk a játékoslistából, és ezt a többiek is látni fogják.",
      confirmLabel: "Kilépek",
      cancelLabel: "Maradok",
      onConfirm: async () => {
        await leaveCurrentRoom();
      },
    });
  });
  els.resumeRoomBtn.addEventListener("click", () => {
    if (state.currentRoom) {
      setRoomVisible();
      renderCurrentRoom();
      return;
    }
    rejoinSavedRoom();
  });
  els.joinRoomBtn.addEventListener("click", joinRoom);
  els.managerCloseBtn.addEventListener("click", closePlayerManager);
  els.managerRoot.addEventListener("click", (event) => {
    if (event.target === els.managerRoot) {
      closePlayerManager();
    }
  });
  els.modalConfirmBtn.addEventListener("click", () => {
    const handler = state.modalConfirm;
    hideModal();
    if (handler) handler();
  });
  els.modalCancelBtn.addEventListener("click", () => {
    const handler = state.modalCancel;
    hideModal();
    if (handler) handler();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.currentRoom) return;
    event.preventDefault();
    event.returnValue = "";
  });

  updateResumeCard();
  setLobbyVisible();
  rejoinSavedRoom();
})();

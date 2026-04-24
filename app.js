(function () {
  const POLL_MS = 1200;
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const clientIdKey = "femrud_multiplayer_client_id";
  const deviceNameKey = "femrud_multiplayer_device_name";
  const deviceAvatarKey = "femrud_multiplayer_device_avatar";

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
    if (!state.currentRoom) {
      els.resumeRoomCard.classList.add("hidden");
      return;
    }

    const label = state.currentRoom.game === "kings" ? "Kings Cup" : "Buszozás";
    els.resumeRoomText.textContent = `${label} szoba: ${state.currentRoom.code}. A progressz megmaradt, bármikor visszaléphetsz.`;
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
    updateResumeCard();
  }

  function setRoomVisible() {
    els.lobbyScreen.classList.add("hidden");
    els.roomScreen.classList.remove("hidden");
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

  function renderPlayerAvatar(avatar, fallback) {
    return `<div class="avatar-small" style="${avatar ? `background-image:url(${avatar})` : ""}"></div><div><strong>${escapeHtml(fallback)}</strong></div>`;
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

  function renderCurrentRoom() {
    const room = state.currentRoom;
    if (!room) return;

    state.lastRenderedSignature = JSON.stringify(room);
    updateResumeCard();
    maybeShowIncomingNotification(room);
    els.roomTitle.textContent = room.game === "kings" ? "Kings Cup Multiplayer" : "Buszozás Multiplayer";
    els.roomStatusText.textContent = room.state.status || "";
    els.roomCodeText.textContent = room.code;
    els.roomContent.innerHTML = "";

    if (room.game === "kings") {
      renderKingsRoom(room);
    } else {
      renderBusRoom(room);
    }
  }

  function renderKingsRoom(room) {
    const wrap = document.createElement("div");
    wrap.className = "kings-layout";

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

    const roster = document.createElement("div");
    roster.className = "player-grid";
    room.state.players.forEach((player) => {
      const item = document.createElement("div");
      item.className = "player-card" + (room.state.current_player_name === player.name ? " current-turn" : "");
      const input = document.createElement("input");
      input.value = player.name;
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
    buttons.appendChild(createButton("Lap húzása", "accent", async () => {
      await apiAction("kings_draw", { room: room.code, client_id: state.clientId });
      state.currentRoom = await apiState();
      renderCurrentRoom();
    }, !room.state.started));
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
        <div class="avatar-medium" style="${player.avatar ? `background-image:url(${player.avatar})` : ""}"></div>
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
  els.resumeRoomBtn.addEventListener("click", () => {
    if (!state.currentRoom) return;
    setRoomVisible();
    renderCurrentRoom();
  });
  els.joinRoomBtn.addEventListener("click", joinRoom);
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

  updateResumeCard();
  setLobbyVisible();
})();

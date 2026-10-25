(() => {
  const grid = document.querySelector('#flower-cards');
  const colorInput = document.querySelector('#variant-color');
  const nameInput = document.querySelector('#variant-name');
  const saveButton = document.querySelector('#save-variant');
  const message = document.querySelector('#variant-message');
  const variantList = document.querySelector('#saved-variants');
  const selectedFlowerStatus = document.querySelector('#selected-flower-status');
  const encyclopediaLayout = document.querySelector('.encyclopedia-layout');
  const previewWorld = document.querySelector('.encyclopedia-world');
  const fullscreenToggle = document.querySelector('#preview-fullscreen-toggle');
  const pickerToggle = document.querySelector('#flower-picker-toggle');
  const variantsKey = 'sky-garden-flower-variants-v1';
  const autoCropKey = 'sky-garden-auto-crops-v1';
  const maxVariants = 30;
  if (!grid || !Array.isArray(window.flowerCatalog)) return;
  function syncPreviewFullscreenButton() {
    const active = Boolean(previewWorld && (document.fullscreenElement === previewWorld || previewWorld.classList.contains('is-preview-expanded')));
    if (!fullscreenToggle) return;
    fullscreenToggle.setAttribute('aria-pressed', String(active));
    fullscreenToggle.setAttribute('aria-label', active ? '退出全螢幕預覽' : '進入全螢幕預覽');
    fullscreenToggle.title = active ? '退出全螢幕預覽' : '進入全螢幕預覽';
    fullscreenToggle.textContent = active ? '⤡' : '⛶';
  }
  const pickerIndicator = pickerToggle?.querySelector('.flower-picker-collapse-indicator');
  function syncPickerIndicator(expanded) {
    if (pickerIndicator) pickerIndicator.src = expanded ? 'assets/btn/展開.png' : 'assets/btn/收合.png';
    pickerToggle?.setAttribute('aria-label', expanded
      ? '選擇花種，向下拖曳或點擊收合'
      : '選擇花種，向上拖曳或點擊展開');
  }
  function setPickerExpanded(expanded) {
    if (!encyclopediaLayout || !window.matchMedia('(max-width: 760px)').matches) return;
    encyclopediaLayout.classList.toggle('is-picker-expanded', expanded);
    pickerToggle?.setAttribute('aria-expanded', String(expanded));
    syncPickerIndicator(expanded);
  }
  let pickerDragStartY = null;
  let pickerDragHandled = false;
  pickerToggle?.addEventListener('pointerdown', (event) => {
    if (!window.matchMedia('(max-width: 760px)').matches || event.isPrimary === false) return;
    pickerDragStartY = event.clientY;
    pickerDragHandled = false;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) { /* Pointer capture may be unavailable in older browsers. */ }
  });
  pickerToggle?.addEventListener('pointerup', (event) => {
    if (pickerDragStartY === null) return;
    const deltaY = event.clientY - pickerDragStartY;
    pickerDragStartY = null;
    if (Math.abs(deltaY) < 36) return;
    pickerDragHandled = true;
    setPickerExpanded(deltaY < 0);
  });
  pickerToggle?.addEventListener('pointercancel', () => { pickerDragStartY = null; });
  pickerToggle?.addEventListener('click', () => {
    if (pickerDragHandled) {
      pickerDragHandled = false;
      return;
    }
    if (!encyclopediaLayout || !window.matchMedia('(max-width: 760px)').matches) return;
    setPickerExpanded(!encyclopediaLayout.classList.contains('is-picker-expanded'));
  });
  if (window.matchMedia('(max-width: 760px)').matches) setPickerExpanded(false);
  else syncPickerIndicator(true);
  window.addEventListener('resize', () => {
    if (window.matchMedia('(max-width: 760px)').matches) setPickerExpanded(false);
    else syncPickerIndicator(true);
  });
  fullscreenToggle?.addEventListener('click', async () => {
    if (!previewWorld) return;
    const active = document.fullscreenElement === previewWorld || previewWorld.classList.contains('is-preview-expanded');
    if (active) {
      if (document.fullscreenElement === previewWorld && typeof document.exitFullscreen === 'function') {
        try { await document.exitFullscreen(); } catch (_) { previewWorld.classList.remove('is-preview-expanded'); }
      } else previewWorld.classList.remove('is-preview-expanded');
      syncPreviewFullscreenButton();
      return;
    }
    try {
      if (typeof previewWorld.requestFullscreen !== 'function') throw new Error('Fullscreen API 不可用');
      await previewWorld.requestFullscreen();
    } catch (_) {
      previewWorld.classList.add('is-preview-expanded');
    }
    syncPreviewFullscreenButton();
  });
  document.addEventListener('fullscreenchange', syncPreviewFullscreenButton);
  window.addEventListener('resize', () => {
    if (window.matchMedia('(min-width: 761px)').matches) {
      encyclopediaLayout?.classList.remove('is-picker-expanded');
      pickerToggle?.setAttribute('aria-expanded', 'true');
    }
  });
  syncPreviewFullscreenButton();

  let selectedIndex = 0;
  let variants = [];
  let autoCropSelection = [];
  let variantStorageUsable = true;
  try {
    variants = JSON.parse(localStorage.getItem(variantsKey) || '[]');
    if (!Array.isArray(variants) || variants.length > maxVariants
      || new Set(variants.map((variant) => variant?.id)).size !== variants.length
      || variants.some((variant) => !variant || typeof variant.id !== 'string' || variant.id.length > 80
        || typeof variant.name !== 'string' || !variant.name.trim() || variant.name.length > 20
        || !Number.isInteger(variant.cropIndex) || variant.cropIndex < 0 || variant.cropIndex >= window.flowerCatalog.length
        || !/^#[0-9a-f]{6}$/i.test(variant.color || ''))) throw new Error('資料格式不相容');
  } catch (_) {
    variants = [];
    variantStorageUsable = false;
    message.textContent = '無法讀取已儲存變種；原花卉資料仍可瀏覽。';
  }

  function setSelectedCard(index) {
    selectedIndex = index;
    for (const card of grid.querySelectorAll('.encyclopedia-card')) {
      const selected = Number(card.dataset.flowerIndex) === index;
      card.classList.toggle('is-selected', selected);
      card.querySelector('.encyclopedia-card-select')?.setAttribute('aria-pressed', String(selected));
    }
  }
  try {
    const savedSelection = JSON.parse(localStorage.getItem(autoCropKey) || 'null');
    if (Array.isArray(savedSelection) && savedSelection.every((index) => Number.isInteger(index) && index >= 0 && index < window.flowerCatalog.length)
      && new Set(savedSelection).size === savedSelection.length) autoCropSelection = savedSelection;
    else {
      const gardenSave = JSON.parse(localStorage.getItem('sky-garden-save-v1') || 'null');
      autoCropSelection = Array.isArray(gardenSave?.autoCropSelection) ? gardenSave.autoCropSelection : [0];
      localStorage.setItem(autoCropKey, JSON.stringify(autoCropSelection));
    }
  } catch (_) { autoCropSelection = [0]; }
  function updatePreview() {
    const flower = window.flowerCatalog[selectedIndex];
    const selected = window.skyWorld?.selectGalleryFlower(selectedIndex, colorInput.value);
    if (selectedFlowerStatus) selectedFlowerStatus.textContent = `目前展示：${flower.name}`;
    return selected;
  }
  function renderVariants() {
    variantList.replaceChildren();
    const matching = variants.filter((variant) => variant.cropIndex === selectedIndex);
    for (const variant of matching) {
      const item = document.createElement('div');
      item.className = 'saved-variant-item';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'saved-variant';
      button.setAttribute('aria-label', `預覽變種：${variant.name}`);
      button.innerHTML = '<span aria-hidden="true"></span>';
      button.querySelector('span').style.backgroundColor = variant.color;
      button.append(document.createTextNode(`${variant.name}`));
      button.addEventListener('click', () => {
        nameInput.value = variant.name;
        colorInput.value = variant.color;
        updatePreview();
        message.textContent = `正在預覽「${window.flowerCatalog[selectedIndex].name}・${variant.name}」。`;
      });
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'delete-variant';
      deleteButton.textContent = '×';
      deleteButton.setAttribute('aria-label', `刪除變種：${variant.name}`);
      deleteButton.addEventListener('click', () => {
        if (!window.confirm(`確定刪除「${window.flowerCatalog[selectedIndex].name}・${variant.name}」？已種植的花會保留此變種外觀。`)) return;
        const previousVariants = variants;
        const saveKey = 'sky-garden-save-v1';
        let previousSave = null;
        try {
          previousSave = localStorage.getItem(saveKey);
          if (previousSave) {
            const save = JSON.parse(previousSave);
            if (Array.isArray(save.plots)) {
              for (const plot of save.plots) {
                if (plot?.variantId !== variant.id) continue;
                plot.variantName = variant.name;
                plot.variantColor = variant.color;
                delete plot.variantId;
              }
              localStorage.setItem(saveKey, JSON.stringify(save));
            }
          }
          variants = variants.filter((item) => item.id !== variant.id);
          localStorage.setItem(variantsKey, JSON.stringify(variants));
          renderVariants();
          message.textContent = `已刪除變種「${variant.name}」。已種植的花會保留原外觀。`;
        } catch (_) {
          variants = previousVariants;
          try {
            if (previousSave !== null) localStorage.setItem(saveKey, previousSave);
          } catch (_) { /* Keep the original variant data if rollback is unavailable. */ }
          message.textContent = '刪除未完成，瀏覽器無法更新變種或存檔。';
        }
      });
      item.append(button, deleteButton);
      variantList.append(item);
    }
    saveButton.disabled = !variantStorageUsable || variants.length >= maxVariants;
    if (saveButton.disabled && variantStorageUsable) message.textContent = `已達 ${maxVariants} 個變種上限，無法再新增。`;
  }

  window.flowerCatalog.forEach((flower, index) => {
    const card = document.createElement('article');
    card.className = 'encyclopedia-card';
    card.dataset.flowerIndex = String(index);
    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'encyclopedia-card-select';
    selectButton.setAttribute('aria-pressed', String(index === 0));
    const name = document.createElement('span');
    name.className = 'encyclopedia-card-title';
    name.setAttribute('role', 'heading');
    name.setAttribute('aria-level', '2');
    const flowerImage = document.createElement('img');
    flowerImage.className = 'flower-pixel-icon encyclopedia-pixel-icon';
    flowerImage.src = flower.image || '';
    flowerImage.width = 32;
    flowerImage.height = 32;
    flowerImage.alt = '';
    flowerImage.setAttribute('aria-hidden', 'true');
    flowerImage.decoding = 'async';
    flowerImage.style.imageRendering = 'pixelated';
    flowerImage.addEventListener('error', () => { flowerImage.hidden = true; name.dataset.iconFallback = flower.emoji; });
    name.append(flowerImage, document.createTextNode(' ' + flower.name));
    const meaning = document.createElement('span');
    meaning.className = 'encyclopedia-meaning';
    meaning.textContent = `花語意象：${flower.meaning}`;
    const details = document.createElement('span');
    details.className = 'encyclopedia-details';
    details.textContent = `遊戲生長時間 ${flower.growTime / 1000} 秒 · 模型基準高度 ${flower.height.toFixed(2)} 土地單位`;
    selectButton.append(name, meaning, details);
    const autoLabel = document.createElement('label');
    autoLabel.className = 'encyclopedia-auto-crop';
    const autoCheckbox = document.createElement('input');
    autoCheckbox.type = 'checkbox';
    autoCheckbox.checked = autoCropSelection.includes(index);
    autoCheckbox.setAttribute('aria-label', `自動播種${flower.name}`);
    autoCheckbox.addEventListener('change', () => {
      const previousSelection = autoCropSelection;
      autoCropSelection = autoCheckbox.checked
        ? [...autoCropSelection, index].sort((a, b) => a - b)
        : autoCropSelection.filter((cropIndex) => cropIndex !== index);
      try {
        localStorage.setItem(autoCropKey, JSON.stringify(autoCropSelection));
        message.textContent = autoCheckbox.checked ? `已將${flower.name}加入自動播種花種。` : `已從自動播種花種移除${flower.name}。`;
      } catch (_) {
        autoCheckbox.checked = !autoCheckbox.checked;
        autoCropSelection = previousSelection;
        message.textContent = '無法儲存自動播種設定，請檢查瀏覽器儲存權限。';
      }
    });
    autoLabel.append(autoCheckbox, document.createTextNode('自動播種'));
    card.append(selectButton, autoLabel);
    grid.append(card);
  });

  grid.addEventListener('click', (event) => {
    const selectButton = event.target.closest('.encyclopedia-card-select');
    const card = selectButton?.closest('.encyclopedia-card[data-flower-index]');
    if (!card || !grid.contains(card)) return;
    const index = Number(card.dataset.flowerIndex);
    const flower = window.flowerCatalog[index];
    if (!flower) return;
    setPickerExpanded(false);
    setSelectedCard(index);
    colorInput.value = flower.color;
    nameInput.value = '';
    updatePreview();
    renderVariants();
  });

  setSelectedCard(0);
  colorInput.value = window.flowerCatalog[0].color;
  updatePreview();
  renderVariants();
  colorInput.addEventListener('input', updatePreview);
  saveButton.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name || name.length > 20) {
      message.textContent = '請輸入 1 到 20 個字的變種名稱。';
      nameInput.focus();
      return;
    }
    if (variants.length >= maxVariants) {
      message.textContent = `最多可儲存 ${maxVariants} 個變種。`;
      return;
    }
    const variant = {
      id: `flower-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      cropIndex: selectedIndex,
      color: colorInput.value.toLowerCase(),
    };
    try {
      variants.push(variant);
      localStorage.setItem(variantsKey, JSON.stringify(variants));
      renderVariants();
      message.textContent = `已儲存「${window.flowerCatalog[selectedIndex].name}・${name}」，回到花園即可手動種植。`;
    } catch (_) {
      variants.pop();
      variantStorageUsable = false;
      renderVariants();
      message.textContent = '無法儲存變種，請檢查瀏覽器儲存空間。';
    }
  });
})();

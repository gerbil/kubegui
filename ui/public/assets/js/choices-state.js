function choicesRecent(select) {
  // Defensive guard: track if destroyed to prevent operations on dead instance
  let isDestroyed = false;
  // Get all current options (both static and dynamic)
  const getAllOptions = () => {
    try {
      if (!select || isDestroyed) return [];
      const opts = Array.from(select.options || []);
      return opts.map(o => ({
        value: String(o.value || ''),
        label: String(o.textContent || '')
      }));
    } catch (e) {
      console.warn('choicesRecent: Failed to get options:', e);
      return [];
    }
  };
  const options = getAllOptions();
  const STORAGE_KEY = 'choicesRecent';
  const MAX_RECENT = 3;
  let choices = null;
  let choicesDestroyed = false;
  try {
    if (select && !isDestroyed) {
      choices = new Choices(select, {
        shouldSort: false,
        itemSelectText: "",
        searchEnabled: true,
        searchResultLimit: 1000,
        fuseOptions: {
          includeScore: true,
          threshold: 0.0,
          distance: 0,
          ignoreLocation: true,
          useExtendedSearch: true,
        }
      });
    }
  } catch (e) {
    console.warn('choicesRecent: Failed to initialize Choices:', e);
    choicesDestroyed = true;
  }
  // Check if Choices operations are paused (e.g., during deletion)
  const isChoicesPaused = () => {
    try {
      return window.__choicesPaused === true;
    } catch {
      return false;
    }
  };
  // Reorder options with recent items first
  function reorderOptions() {
    if (isDestroyed || choicesDestroyed || !choices || typeof choices.setChoices !== 'function') return;
    if (isChoicesPaused()) return; // Skip if paused
    try {
      var recent = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const reordered = [
        ...recent.map(v => options.find(o => o.value === v)).filter(Boolean),
        ...options.filter(o => !recent.includes(o.value))
      ];
      choices.setChoices(reordered, 'value', 'label', true);
    } catch (e) {
      console.warn('choicesRecent: Failed to reorder options:', e);
    }
  }
  // Initial load
  if (!isDestroyed && !choicesDestroyed) {
    reorderOptions();
    if (select && select.value && choices && typeof choices.setChoiceByValue === 'function') {
      try {
        choices.setChoiceByValue(select.value);
      } catch (e) {
        console.warn('choicesRecent: Failed to set initial choice value:', e);
      }
    }
  }
  // Handle changes
  const onChange = () => {
    if (isDestroyed || choicesDestroyed || !choices) return;
    if (isChoicesPaused()) return; // Skip if paused
    try {
      const value = select.value;
      var recent = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const updated = [value, ...recent.filter(v => v !== value)].slice(0, MAX_RECENT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      reorderOptions();
      if (select.value && typeof choices.setChoiceByValue === 'function') {
        choices.setChoiceByValue(select.value);
      }
    } catch (e) {
      console.warn('choicesRecent: Error in onChange:', e);
    }
  };
  // Listen for dynamic option additions
  const onAfterProcess = () => {
    if (isDestroyed || choicesDestroyed || !choices) return;
    if (isChoicesPaused()) return; // Skip if paused
    try {
      reorderOptions();
      if (select.value && typeof choices.setChoiceByValue === 'function') {
        choices.setChoiceByValue(select.value);
      }
    } catch (e) {
      console.warn('choicesRecent: Error in onAfterProcess:', e);
    }
  };
  try {
    if (select && !isDestroyed) {
      select.addEventListener('change', onChange);
      select.addEventListener('hx:afterProcess', onAfterProcess);
    }
  } catch (e) {
    console.warn('choicesRecent: Failed to add event listeners:', e);
  }
  return {
    destroy() {
      if (isDestroyed) return;
      isDestroyed = true;
      try {
        if (select) {
          select.removeEventListener('change', onChange);
          select.removeEventListener('hx:afterProcess', onAfterProcess);
        }
        if (choices && typeof choices.destroy === 'function') {
          choices.destroy();
        }
      } catch (e) {
        console.warn('choicesRecent: Error during destroy:', e);
      } finally {
        choices = null;
        choicesDestroyed = true;
      }
    },
    setChoiceByValue(value) {
      if (isDestroyed || choicesDestroyed || !choices || typeof choices.setChoiceByValue !== 'function') return;
      if (isChoicesPaused()) return; // Skip if paused
      try {
        choices.setChoiceByValue(value);
      } catch (e) {
        console.warn('choicesRecent: Failed to set choice by value:', e);
      }
    }
  };
}

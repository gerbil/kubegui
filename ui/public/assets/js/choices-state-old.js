function choicesRecent(select) {

  // Get all current options (both static and dynamic)
  const getAllOptions = () => {
    try {
      return Array.from(select.options).map(o => ({
        value: o.value,
        label: o.textContent
      }))
    } catch (e) {
      console.error('Failed to get options from select:', e)
      return []
    }
  };

  const options = getAllOptions();

  const STORAGE_KEY = 'choicesRecent';
  const MAX_RECENT = 3;

  let choices = null;
  try {
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
  } catch (e) {
    console.error('Failed to create Choices instance:', e)
    return {
      destroy() { },
      setChoiceByValue() { }
    }
  }

  // Reorder options with recent items first
  function reorderOptions() {
    if (!choices || typeof choices.setChoices !== 'function') return
    try {
      var recent = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const reordered = [
        ...recent.map(v => options.find(o => o.value === v)).filter(Boolean),
        ...options.filter(o => !recent.includes(o.value))
      ];
      choices.setChoices(reordered, 'value', 'label', true);
    } catch (e) {
      console.error('Failed to reorder options:', e)
    }
  }

  // Initial load
  reorderOptions();
  if (select.value && choices && typeof choices.setChoiceByValue === 'function') {
    try {
      choices.setChoiceByValue(select.value);
    } catch (e) {
      console.warn('Failed to set choice by value:', e)
    }
  }

  // Handle changes
  const onChange = () => {
    if (!choices) return
    try {
      const value = select.value;
      var recent = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const updated = [value, ...recent.filter(v => v !== value)].slice(0, MAX_RECENT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      reorderOptions(); // Reorder after storage update
      if (select.value && typeof choices.setChoiceByValue === 'function') {
        choices.setChoiceByValue(select.value);
      }
    } catch (e) {
      console.error('Error in onChange handler:', e)
    }
  };

  // Listen for dynamic option additions
  const onAfterProcess = () => {
    if (!choices) return
    try {
      reorderOptions(); // Reorder when new options are added dynamically
      if (select.value && typeof choices.setChoiceByValue === 'function') {
        choices.setChoiceByValue(select.value);
      }
    } catch (e) {
      console.error('Error in onAfterProcess handler:', e)
    }
  };

  select.addEventListener('change', onChange);
  select.addEventListener('hx:afterProcess', onAfterProcess);

  return {
    destroy() {
      try {
        select.removeEventListener('change', onChange);
        select.removeEventListener('hx:afterProcess', onAfterProcess);
        if (choices && typeof choices.destroy === 'function') {
          choices.destroy();
        }
        choices = null;
      } catch (e) {
        console.error('Error during destroy:', e)
      }
    },
    setChoiceByValue(value) {
      if (!choices || typeof choices.setChoiceByValue !== 'function') return
      try {
        choices.setChoiceByValue(value);
      } catch (e) {
        console.warn('Failed to set choice by value:', e)
      }
    }
  };
}
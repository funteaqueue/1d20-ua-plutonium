# Кнопка «Копіювати для Foundry» для конструктора 1d20

Користувач створює персонажа на сайті, натискає кнопку, переходить у Foundry й вставляє JSON через **Ctrl+V** над аркушем або бічною панеллю. Модуль збирає персонажа через Plutonium і показує звіт перед записом.

## Що передати розробнику

1. Цей документ із готовим HTML/JavaScript нижче.
2. Файл [character-builder-export.js](../tools/character-builder-export.js) — адаптер експорту, версія 0.2.0, контракт `1d20.character`, `schemaVersion: 1`.

Не потрібні новий API endpoint, серверна авторизація чи CORS. Файл працює у браузері поруч із наявними скриптами конструктора. Він читає поточного героя й довідник, обчислює знімок на копії стану та не змінює героя. Залежності: `window.MASTER_DATA`, `window.CBD`, `window.CBSheet`; для повного знімка підключіть також решту штатних скриптів конструктора.

## Готовий сніпет

Збережіть адаптер у ресурсах сайту, наприклад `/assets/character-builder-export.js`. Підключіть його **після скриптів конструктора**, без `async`. Шлях замініть на свій. У WordPress ці скрипти можна підключити через штатний `wp_enqueue_script` із залежностями від скриптів конструктора; якщо CSP забороняє inline-код, винесіть другий блок у власний JS-файл.

Розмітку `data-foundry-export` додайте в шаблон підсумку персонажа. Обробник нижче делегований: він працює й після перерендеру цієї розмітки. Самі скрипти достатньо підключити один раз на сторінку.

```html
<script src="/assets/character-builder-export.js?v=0.2.0"></script>

<div data-foundry-export>
  <button type="button" data-foundry-copy>Копіювати для Foundry</button>
  <p data-foundry-status role="status" aria-live="polite"></p>
  <label data-foundry-fallback hidden>
    Скопіюйте весь JSON вручну (Ctrl+A, Ctrl+C у цьому полі):
    <textarea data-foundry-json readonly rows="8"
              aria-label="JSON персонажа для Foundry"></textarea>
  </label>
</div>

<script>
(() => {
  if (window.__d20FoundryCopyInstalled) return;
  window.__d20FoundryCopyInstalled = true;

  document.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-foundry-copy]');
    if (!button || button.disabled) return;
    const root = button.closest('[data-foundry-export]');
    if (!root) return;
    const status = root.querySelector('[data-foundry-status]');
    const fallback = root.querySelector('[data-foundry-fallback]');
    const textarea = root.querySelector('[data-foundry-json]');
    button.disabled = true;
    fallback.hidden = true;
    textarea.value = '';

    try {
      const exporter = window.D20FoundryExporter;
      if (!exporter || !window.MASTER_DATA || !window.CBD || !window.CBSheet) {
        throw new Error('Конструктор ще завантажується. Спробуйте знову.');
      }

      // Необов'язковий міст до живого стану, описаний нижче.
      const state = window.get1d20FoundryExportState?.();
      const json = exporter.toJSON(state ? {state} : {});
      try {
        await navigator.clipboard.writeText(json);
        status.textContent = 'Скопійовано. У Foundry натисніть Ctrl+V над аркушем персонажа.';
      } catch {
        textarea.value = json;
        fallback.hidden = false;
        textarea.focus();
        textarea.select();
        status.textContent = 'Браузер не дозволив автоматичне копіювання. Скопіюйте JSON із поля нижче.';
      }
    } catch (error) {
      status.textContent = 'Не вдалося експортувати: ' + error.message;
    } finally {
      button.disabled = false;
    }
  });
})();
</script>
```

Автоматичний буфер обміну потребує HTTPS і дозволу браузера. Якщо він недоступний, сніпет показує готовий JSON для ручного копіювання. Дані виводяться через `textContent`/`value`, а не HTML.

## Передати актуальний стан із коду конструктора

Без додаткової інтеграції адаптер читає збереженого поточного героя з `localStorage.dnd_character_v2`. Якщо збереження відкладене, останній вибір може ще не потрапити у localStorage. Рекомендовано додати в коді конструктора, де доступний живий стан:

```js
// currentCharacterState замініть на реальну змінну поточного героя.
// Це має бути getter, який повертає актуальний об'єкт і після перемикання героя.
window.get1d20FoundryExportState = () => currentCharacterState;
```

Якщо кнопка вже має свій обробник усередині конструктора, весь виклик експорту можна звести до:

```js
const json = window.D20FoundryExporter.toJSON({state: currentCharacterState});
await navigator.clipboard.writeText(json);
```

Обробку помилки буфера з основного сніпета варто зберегти. Не підставляйте готовий JSON у JavaScript через шаблонний HTML; формуйте його під час натискання.

## Контракт і API

| Виклик | Результат |
|---|---|
| `D20FoundryExporter.exportCharacter({state})` | JSON-сумісний об'єкт, синхронно |
| `D20FoundryExporter.toJSON({state})` | Рядок JSON, синхронно |
| `await D20FoundryExporter.copy({state})` | Копіює та повертає рядок; відхиляє Promise, якщо буфер недоступний |
| `D20FoundryExporter.download({state})` | Завантажує JSON як файл |
| `D20FoundryExporter.toJSON({state, includePortrait: false})` | Експорт без портрета |

Параметр `state` необов'язковий. Для імпорту передається **весь результат**, не лише `character` або `snapshot`: стан містить конкретні вибори, а довідник допомагає зіставити їх із Plutonium. Не видаляйте незнайомі поля та не перейменовуйте slug/source. Підкласи й підраси мають складені ідентичності.

Власні ресурси вже входять у `state.resources`, наприклад:

```json
{"resources": [{"label": "зяблики", "value": "44"}]}
```

Це лише приклад поля стану, не самостійний експорт. Foundry створює feature із 44/44 використань і дією витрачання одиниці. Період відновлення сайт зараз не задає; користувач налаштовує його у Foundry. Рядки без назви пропускаються, текстові значення зберігаються в описі без лічильника.

Ім'я, біографія, портрет і нотатки входять в експорт. Сніпет не відправляє їх на сервер. `diagnostics` показує незавершені кроки та проблеми з розрахунками; нуль попереджень не означає повної автоматизації кожного правила. Детальний контракт: [документація імпорту](character-builder.uk.md#контракт-v1).

## Перевірка перед додаванням на сайт

1. Відкрити заповненого героя, змінити ім'я й одразу скопіювати. У JSON має бути нове ім'я; це перевіряє міст до живого стану.
2. Перемкнути героя й перевірити, що копіюється саме поточний персонаж.
3. Перерендерити підсумок і перевірити кнопку повторно: одне натискання дає один експорт.
4. Перевірити `JSON.parse(json).format === '1d20.character'` та `schemaVersion === 1`.
5. Перевірити відмову буфера обміну: JSON має залишитися доступним у текстовому полі.
6. Перевірити мультиклас, закляття від різних джерел, власний ресурс із числом і порожні рядки.
7. У Foundry увімкнути Plutonium і модуль `1d20-ua-plutonium`, вставити JSON поза текстовим полем та звірити підготовлений звіт. Текстові поля зберігають звичайну поведінку Ctrl+V.

Для Foundry 13 потрібні пакет модуля для 13, Plutonium для 13 і dnd5e 5.3.x; для Foundry 14 — пакет для 14, відповідний Plutonium і dnd5e 6.x. **Сайт формує однаковий JSON для обох версій** і не потребує перемикача версії Foundry.

Якщо API `CBD` / `CBSheet` змінюється, перевірте адаптер повторно. Він зберігає вихідний стан і описує недоступні обчислення у `diagnostics.warnings`. Формат передачі версіонується окремо від версії адаптера; несумісні зміни контракту потребують нового `schemaVersion`.

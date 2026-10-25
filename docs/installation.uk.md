# Український переклад для Plutonium

Цей модуль додає українські назви й описи з [1d20.com.ua](https://1d20.com.ua) під час імпорту через Plutonium у Foundry VTT. Щоб установити його, достатньо вставити посилання для своєї версії Foundry у вікно встановлення модулів, а потім увімкнути переклад у світі.

## 1. Відкрийте встановлення модулів

На стартовому екрані Foundry натисніть **Add-on Modules → Install Module**.

![Add-on Modules → Install Module](images/guide-1.png)

## 2. Вставте посилання та натисніть Install

Скопіюйте **одне** посилання для своєї версії Foundry:

**Foundry 14**

```text
https://raw.githubusercontent.com/funteaqueue/1d20-ua-plutonium/main/module.json
```

**Foundry 13** — потрібна система **dnd5e 5.3.x**.

```text
https://raw.githubusercontent.com/funteaqueue/1d20-ua-plutonium/main/module-foundry13.json
```

Вставте його в поле **Manifest URL** унизу вікна. Натисніть **Install** поруч із цим полем.

![Поле Manifest URL і кнопка Install](images/guide-2.png)

Якщо Foundry запропонує встановити **Plutonium** або **libWrapper**, натисніть **Install dependency automatically**. Якщо Plutonium уже є, він має відповідати вашій версії Foundry.

## 3. Відкрийте модулі у світі

Запустіть свій світ **dnd5e** та увійдіть як майстер гри.

Праворуч натисніть **шестерні → Module Management** (у Foundry 13 — **Manage Modules**).

![Шестерні та Module Management](images/guide-3.png)

## 4. Увімкніть переклад

- У пошуку введіть **plutonium**.
- Поставте галочки біля **1d20.com.ua — Український переклад для Plutonium** та **Plutonium**.
- Натисніть **Save Module Settings**.
- Якщо Foundry попросить увімкнути залежності або перезавантажити сторінку — погодьтеся.

![Пошук, галочки та Save Module Settings](images/guide-4.png)

Готово. Скопіюйте посилання на закляття або предмет із **1d20.com.ua**, наведіть курсор на аркуш персонажа й натисніть **Ctrl+V** поза текстовим полем.

Хочете перекладати й звичайний імпорт Plutonium? У налаштуваннях перекладача виберіть **Коли перекладати → Завжди**.

*Скріншоти з Foundry 14. За основу взято [гайд 5etools](https://wiki.tercept.net/en/Plutonium/Plutonium_Installation#manifest-url).*

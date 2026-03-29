# 如何新增翻译

假设要新增一个语言 `new`，按下面步骤处理：

1. 复制 `app/locales/en.ts` 为 `app/locales/new.ts`。
2. 编辑 `new.ts`，把 `const en: LocaleType =` 改成 `const new: PartialLocaleType =`，并改成 `export default new;`。
3. 编辑 `app/locales/index.ts`。
4. 增加 `import new from "./new";`。
5. 把 `new` 加入 `ALL_LANGS`。
6. 在 `ALL_LANG_OPTIONS` 中增加 `new: "new lang"`。
7. 翻译 `new.ts` 中的文案。
8. 提交 Pull Request，维护者会处理合并。

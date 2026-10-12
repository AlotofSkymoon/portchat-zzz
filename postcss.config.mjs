/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    /**
     * content 写两遍不是冗余：
     *  - 这里是 @unocss/postcss 插件自己的选项（官方 Next 示例就写在这）
     *  - uno.config.ts 里的 content.filesystem 是给 CLI / 其他集成用的
     * 插件选项优先；两边都写上，避免某一处读取失败时整站样式静默消失。
     * 必须含 .ts —— 默认扫描不含 js/ts，而本项目有类名写在 .ts 生成的字符串里。
     */
    "@unocss/postcss": {
      content: [
        "./app/**/*.{ts,tsx}",
        "./components/**/*.{ts,tsx}",
        "./lib/**/*.{ts,tsx}",
      ],
    },
    autoprefixer: {},
  },
};

export default config;

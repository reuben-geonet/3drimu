export type ThemeName = "dark" | "light";

const STORAGE_KEY = "rimu-theme";
const ICON_SELECTOR = ".control-icon";
const LABEL_SELECTOR = ".control-label";
const SUN_ICON = `
  <svg
    class="tabler-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
    <path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7" />
  </svg>
`;
const MOON_ICON = `
  <svg
    class="tabler-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z" />
  </svg>
`;

export class ThemeController {
  private current: ThemeName;
  private readonly button: HTMLButtonElement;
  private readonly listeners = new Set<(theme: ThemeName) => void>();

  constructor(button: HTMLButtonElement) {
    this.button = button;
    this.current = this.getInitialTheme();
    this.apply(this.current);

    this.button.addEventListener("click", () => {
      this.setTheme(this.current === "dark" ? "light" : "dark");
    });
  }

  get theme(): ThemeName {
    return this.current;
  }

  onChange(listener: (theme: ThemeName) => void): void {
    this.listeners.add(listener);
  }

  setTheme(theme: ThemeName): void {
    this.current = theme;
    localStorage.setItem(STORAGE_KEY, theme);
    this.apply(theme);
    for (const listener of this.listeners) {
      listener(theme);
    }
  }

  private apply(theme: ThemeName): void {
    const nextTheme = theme === "dark" ? "light" : "dark";
    const label = nextTheme === "light" ? "Light" : "Dark";
    const icon = nextTheme === "light" ? SUN_ICON : MOON_ICON;

    document.documentElement.dataset.theme = theme;
    this.button.setAttribute("aria-label", `Switch to ${nextTheme} mode`);

    const iconElement = this.button.querySelector<HTMLElement>(ICON_SELECTOR);
    const labelElement = this.button.querySelector<HTMLElement>(LABEL_SELECTOR);

    if (iconElement) {
      iconElement.innerHTML = icon;
    }

    if (labelElement) {
      labelElement.textContent = label;
    }
  }

  private getInitialTheme(): ThemeName {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored === "dark" || stored === "light") {
      return stored;
    }

    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
}

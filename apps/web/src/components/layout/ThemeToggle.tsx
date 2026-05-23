import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../theme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      className="theme-switch"
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light theme" : "Dark theme"}
    >
      <span className="theme-switch-label">{isDark ? "Dark" : "Light"}</span>
      <span className="theme-switch-track" aria-hidden="true">
        <span className="theme-switch-thumb">{isDark ? <Moon size={13} /> : <Sun size={13} />}</span>
      </span>
    </button>
  );
}

import { useUi, type ThemePref } from '../stores/ui';
import { IconButton } from './ui';
import { Icons } from './icons';
import { HiOutlineComputerDesktop } from 'react-icons/hi2';

const next: Record<ThemePref, ThemePref> = { light: 'dark', dark: 'system', system: 'light' };
const label: Record<ThemePref, string> = { light: 'Thème blanc (actif)', dark: 'Thème sombre (actif)', system: 'Thème système' };

export function ThemeToggle() {
  const { theme, setTheme } = useUi();
  const Icon = theme === 'light' ? Icons.Sun : theme === 'dark' ? Icons.Moon : HiOutlineComputerDesktop;
  return (
    <IconButton
      label={`${label[theme]} — changer de thème`}
      onClick={() => setTheme(next[theme])}
      className="text-muted hover:text-ink"
    >
      <Icon className="h-5 w-5" />
    </IconButton>
  );
}

import { createTheme } from '@mui/material/styles';

// Palette/typography/shape values mirror src/theme/tokens.css, which mirrors
// DESIGN-vercel.md's colors/typography/rounded blocks verbatim.

const createAppTheme = (isDark = false) => createTheme({
  palette: {
    mode: isDark ? 'dark' : 'light',
    primary: {
      main: isDark ? '#e6edf3' : '#171717',
      dark: isDark ? '#c9d1d9' : '#000000',
      light: isDark ? '#8b949e' : '#4d4d4d',
      contrastText: isDark ? '#0d1117' : '#FFFFFF',
    },
    secondary: {
      main: '#0070f3', // link — active nav, focus, in-app accents (same in both modes)
      light: isDark ? '#1a3a66' : '#d3e5ff',
      dark: '#0761d1',
    },
    text: {
      primary: isDark ? '#e6edf3' : '#171717',
      secondary: isDark ? '#8b949e' : '#4d4d4d',
      disabled: isDark ? '#6e7681' : '#a1a1a1',
    },
    background: {
      default: isDark ? '#0d1117' : '#fafafa',
      paper: isDark ? '#161b22' : '#ffffff',
    },
    divider: isDark ? '#30363d' : '#ebebeb',
    action: {
      active: '#0070f3',
      hover: isDark ? '#21262d' : '#f2f2f2',
      selected: isDark ? '#1a3a66' : '#d3e5ff',
    },
    warning: { main: '#f5a623', light: isDark ? '#3d2a15' : '#ffefcf' },
    error: { main: '#ff4444', dark: isDark ? '#ff2222' : '#c50000' },
    success: { main: isDark ? '#3fb950' : '#28a745' },
  },
  typography: {
    fontFamily: '"Inter", "SF Pro Display", system-ui, sans-serif',
    h1: { fontSize: 48, fontWeight: 600, lineHeight: 1.0, letterSpacing: '-2.4px' },
    h2: { fontSize: 32, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-1.28px' },
    h3: { fontSize: 26, fontWeight: 600, lineHeight: 1.12, letterSpacing: '-0.26px' },
    h4: { fontSize: 22, fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.22px' },
    h5: { fontSize: 20, fontWeight: 600, lineHeight: 1.4, letterSpacing: '-0.4px' },
    h6: { fontSize: 18, fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontWeight: 500 },
    body1: { fontSize: 16, fontWeight: 400, lineHeight: 1.4 },
    body2: { fontSize: 14, fontWeight: 400, lineHeight: 1.4 },
    caption: { fontSize: 13, fontWeight: 400, lineHeight: 1.4, letterSpacing: '-0.39px' },
    button: {
      fontSize: 14,
      fontWeight: 500,
      lineHeight: 1.43,
      textTransform: 'none',
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 6, // {rounded.sm} — app/nav chrome default
          padding: '0px 6px', // {components.button-primary-sm/button-ghost-sm} — horizontal-only, height set by line-height
          boxShadow: 'none',
          transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
          '&:hover': { boxShadow: 'none' },
        },
        containedPrimary: {
          backgroundColor: isDark ? '#238636' : '#171717',
          color: isDark ? '#ffffff' : '#ffffff',
          '&:hover': { backgroundColor: isDark ? '#2ea043' : '#000000' },
        },
        outlined: {
          borderColor: isDark ? '#30363d' : '#ebebeb',
          color: isDark ? '#e6edf3' : '#171717',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: `1px solid ${isDark ? '#30363d' : '#ebebeb'}`,
          boxShadow: 'none',
          backgroundImage: 'none',
          backgroundColor: isDark ? '#161b22' : '#ffffff',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: `1px solid ${isDark ? '#30363d' : '#ebebeb'}`,
          boxShadow: 'none',
          backgroundColor: isDark ? '#161b22' : '#ffffff',
        },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: `1px solid ${isDark ? '#30363d' : '#ebebeb'}`,
          boxShadow: 'none',
          backgroundColor: isDark ? '#161b22' : '#ffffff',
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: isDark ? '#0d1117' : '#f2f2f2',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: isDark ? '#30363d' : '#ebebeb',
          fontFeatureSettings: '"tnum"',
        },
        head: {
          fontWeight: 500,
          color: isDark ? '#8b949e' : '#4d4d4d',
          backgroundColor: isDark ? '#0d1117' : '#f2f2f2',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 6,
          },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: `
        body {
          font-feature-settings: "ss01";
        }
      `,
    },
  },
});

export default createAppTheme;

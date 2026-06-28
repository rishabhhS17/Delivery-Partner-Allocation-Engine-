import { createTheme } from '@mui/material/styles';
import { Grow } from '@mui/material';

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
      default: isDark ? '#0d1117' : '#faf9f6',
      paper: isDark ? '#161b22' : '#ffffff',
    },
    divider: isDark ? '#30363d' : '#e7e4df',
    action: {
      active: '#0070f3',
      hover: isDark ? '#21262d' : '#f4f2ee',
      selected: isDark ? '#1a3a66' : '#d3e5ff',
    },
    // Info is its own "elegant cyan" role, distinct from the primary accent blue —
    // already in informal use as the map's "customer" marker color.
    info: {
      main: isDark ? '#22d3ee' : '#06b6d4',
      light: isDark ? '#083344' : '#cffafe',
      dark: isDark ? '#67e8f9' : '#0e7490',
      contrastText: isDark ? '#0d1117' : '#ffffff',
    },
    warning: {
      main: '#f5a623',
      light: isDark ? '#3d2a15' : '#ffefcf',
      dark: isDark ? '#ffb84d' : '#ab570a',
    },
    // "Modern crimson" rather than a flat pure red.
    error: {
      main: isDark ? '#f87171' : '#dc2626',
      light: isDark ? '#450a0a' : '#fde2e2',
      dark: isDark ? '#fca5a5' : '#b91c1c',
    },
    // Rich emerald.
    success: {
      main: isDark ? '#34d399' : '#059669',
      light: isDark ? '#064e3b' : '#d1fae5',
      dark: isDark ? '#6ee7b7' : '#047857',
    },
  },
  typography: {
    fontFamily: '"Inter", "SF Pro Display", system-ui, sans-serif',
    h1: { fontFamily: 'var(--font-display)', fontSize: 48, fontWeight: 700, lineHeight: 1.0, letterSpacing: '-2.4px' },
    h2: { fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, lineHeight: 1.25, letterSpacing: '-1.28px' },
    h3: { fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, lineHeight: 1.12, letterSpacing: '-0.26px' },
    h4: { fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.22px' },
    h5: { fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, lineHeight: 1.4, letterSpacing: '-0.4px' },
    h6: { fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, lineHeight: 1.4 },
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
  transitions: {
    duration: {
      shortest: 150, shorter: 150, short: 150,
      standard: 250, complex: 250,
      enteringScreen: 200, leavingScreen: 150,
    },
    easing: {
      easeInOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
      easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
      easeIn: 'cubic-bezier(0.16, 1, 0.3, 1)',
      sharp: 'cubic-bezier(0.16, 1, 0.3, 1)',
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 6, // {rounded.sm} — app/nav chrome default
          boxShadow: 'none',
          transition: 'background-color var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out)',
          '&:hover': { boxShadow: 'none', transform: 'scale(1.02)' },
          '&:active': { transform: 'scale(0.98)' },
          '&.Mui-disabled': { transform: 'none' },
        },
        sizeSmall: { height: 32, padding: '0px 12px', fontSize: 13 },
        sizeMedium: { height: 40, padding: '0px 16px' },
        sizeLarge: { height: 48, padding: '0px 24px', fontSize: 16 },
        containedPrimary: {
          backgroundColor: isDark ? '#e6edf3' : '#171717',
          color: isDark ? '#0d1117' : '#ffffff',
          // Rest state stays the brand ink — the richer blue/cyan only shows up as the
          // "premium" reward on hover, so the static UI doesn't lose its black/white identity.
          '&:hover': {
            backgroundImage: isDark
              ? 'linear-gradient(135deg, #58a6ff, #22d3ee)'
              : 'linear-gradient(135deg, #0070f3, #00c2ff)',
            backgroundColor: isDark ? '#58a6ff' : '#0070f3',
            color: '#ffffff',
            boxShadow: 'var(--shadow-md)',
          },
        },
        containedError: {
          '&:hover': { backgroundColor: isDark ? '#fca5a5' : '#b91c1c', boxShadow: 'var(--shadow-md)' },
        },
        outlined: {
          borderColor: isDark ? '#30363d' : '#e7e4df',
          color: isDark ? '#e6edf3' : '#171717',
          '&:hover': {
            borderColor: 'var(--link)',
            color: 'var(--link)',
            backgroundColor: 'var(--link-soft)',
          },
        },
        text: {
          '&:hover': {
            color: 'var(--link)',
            backgroundColor: 'var(--link-soft)',
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          transition: 'background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out)',
          '&:hover': { transform: 'scale(1.06)' },
          '&:active': { transform: 'scale(0.94)' },
        },
        colorError: {
          '&:hover': { backgroundColor: isDark ? 'rgba(255,68,68,0.12)' : 'rgba(238,0,0,0.08)' },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: `1px solid ${isDark ? '#30363d' : '#e7e4df'}`,
          boxShadow: 'none',
          backgroundImage: 'none',
          backgroundColor: isDark ? '#161b22' : '#ffffff',
          transition: 'background-color var(--duration-base) var(--ease-out), border-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        // MUI's own AppBar base rule sets width:100%/left:auto unconditionally (not media-gated),
        // so a plain CSS-module media query at equal specificity can lose the cascade depending on
        // stylesheet insertion order. Overriding it here goes through MUI's own override pipeline,
        // which always applies after the base styles — the permanent 240px sidebar needs this to
        // reliably make room instead of rendering full-width underneath it.
        root: {
          // The global MuiPaper override gives every Paper a 12px radius + a full border.
          // For the fixed top bar that means rounded corners and a stray left border butting
          // against the sidebar's right border — square it off and keep only the bottom hairline.
          borderRadius: 0,
          border: 'none',
          borderBottom: `1px solid ${isDark ? '#30363d' : '#e7e4df'}`,
          transition: 'background-color var(--duration-base) var(--ease-out), border-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out)',
          '@media (min-width: 600px)': {
            width: 'calc(100% - 240px)',
            marginLeft: 240,
          },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          // Same reason as MuiAppBar: drop the inherited Paper radius + full border so the
          // sidebar reads as a flush panel with only its right hairline, meeting the top bar
          // in a clean corner instead of two rounded edges.
          borderRadius: 0,
          border: 'none',
          borderRight: `1px solid ${isDark ? '#30363d' : '#e7e4df'}`,
          transition: 'background-color var(--duration-base) var(--ease-out), border-color var(--duration-base) var(--ease-out)',
        },
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: {
          backgroundColor: 'var(--overlay)',
        },
      },
    },
    MuiDialog: {
      defaultProps: {
        TransitionComponent: Grow, // fade + scale(0.97→1) open/close instead of MUI's default opacity-only Fade
      },
      styleOverrides: {
        paper: {
          boxShadow: 'var(--shadow-modal)',
          backgroundColor: 'var(--surface-raised)',
          transition: 'background-color var(--duration-base) var(--ease-out)',
        },
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: {
          boxShadow: 'var(--shadow-md)',
          backgroundColor: 'var(--surface-raised)',
          transition: 'background-color var(--duration-base) var(--ease-out)',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: isDark ? '#30363d' : '#171717',
          boxShadow: 'var(--shadow-md)',
          fontSize: 12,
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 6 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: `1px solid ${isDark ? '#30363d' : '#e7e4df'}`,
          boxShadow: 'none',
          backgroundColor: isDark ? '#161b22' : '#ffffff',
          transition: 'background-color var(--duration-base) var(--ease-out), border-color var(--duration-base) var(--ease-out)',
        },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          borderRadius: 'var(--radius-xl)',
          border: `1px solid ${isDark ? '#30363d' : '#e7e4df'}`,
          boxShadow: 'none',
          backgroundColor: isDark ? '#161b22' : '#ffffff',
          transition: 'background-color var(--duration-base) var(--ease-out), border-color var(--duration-base) var(--ease-out)',
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: isDark ? '#0d1117' : '#f4f2ee',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'background-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out)',
          '&:hover': {
            // body rows only — head cells are position:sticky and stay opaque regardless
            backgroundColor: isDark ? '#21262d' : '#f6f4f1',
            transform: 'translateY(-1px)',
            boxShadow: 'var(--shadow-sm)',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: isDark ? '#30363d' : '#e7e4df',
          fontFeatureSettings: '"tnum"',
          padding: '14px 20px',
        },
        body: {
          padding: '20px 20px',
        },
        head: {
          fontWeight: 500,
          color: isDark ? '#8b949e' : '#4d4d4d',
          // sticky glass header — translucent + blurred so it reads as "floating" while scrolling
          backgroundColor: isDark
            ? 'color-mix(in srgb, #0d1117 85%, transparent)'
            : 'color-mix(in srgb, #f4f2ee 85%, transparent)',
          backdropFilter: 'blur(8px)',
          position: 'sticky',
          top: 0,
          zIndex: 1,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 6,
            transition: 'box-shadow var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)',
            '&.Mui-focused': {
              boxShadow: '0 0 0 3px var(--focus-ring)',
            },
          },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          transition: 'background-color var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out)',
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

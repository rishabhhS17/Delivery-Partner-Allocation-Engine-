import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: {
      main: '#FC8019',
      dark: '#E46F12',
      light: '#FFA94D',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#EF4F5F',
      light: '#FFF1F3',
    },
    text: {
      primary: '#2D2A26',
      secondary: '#4B463F',
      disabled: '#6F6A63',
    },
    background: {
      default: '#FAF8F5',
      paper: '#FFFFFF',
    },
    divider: '#F1E7DA',
    action: {
      active: '#FC8019',
      hover: '#FFF1E3',
      selected: '#FFF1E3',
    },
  },
  typography: {
    fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: {
      fontSize: 56,
      fontWeight: 300,
      lineHeight: 1.03,
      letterSpacing: '-1.4px',
    },
    h2: {
      fontSize: 48,
      fontWeight: 300,
      lineHeight: 1.15,
      letterSpacing: '-0.96px',
    },
    h3: {
      fontSize: 32,
      fontWeight: 300,
      lineHeight: 1.1,
      letterSpacing: '-0.64px',
    },
    h4: {
      fontWeight: 700,
    },
    h5: {
      fontWeight: 600,
    },
    h6: {
      fontWeight: 600,
    },
    subtitle1: {
      fontWeight: 600,
    },
    body1: {
      fontSize: 15,
      fontWeight: 400,
      lineHeight: 1.4,
    },
    body2: {
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: '-0.42px',
      fontFeatureSettings: '"tnum"',
    },
    button: {
      fontSize: 16,
      fontWeight: 600,
      lineHeight: 1.0,
      textTransform: 'none',
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 9999,
          padding: '8px 16px',
          transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid #F1E7DA',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid #F1E7DA',
          boxShadow: '0 1px 3px rgba(45, 42, 38, 0.05)',
        },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid #F1E7DA',
          boxShadow: 'none',
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: '#F9F5F0',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          fontFeatureSettings: '"tnum"',
        },
        head: {
          fontWeight: 500,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
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

export default theme;

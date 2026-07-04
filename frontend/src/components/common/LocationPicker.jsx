import 'mapbox-gl/dist/mapbox-gl.css';
import { useCallback } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import Map, { Marker } from 'react-map-gl';
import styles from './LocationPicker.module.css';

const MAPBOX_TOKEN  = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';
const RANCHI_CENTER = { longitude: 85.33, latitude: 23.35, zoom: 13 };
const MAP_STYLE     = 'mapbox://styles/mapbox/dark-v11';

// Reusable across Rider/Restaurant/Customer create dialogs. `latitude`/`longitude` are kept as
// strings (matching the existing form-state convention used everywhere else in these dialogs —
// callers coerce to Number() once, right before submit); both the map click and the manual
// text fields funnel through the same `onChange(latStr, lngStr)` so the two stay in sync.
export default function LocationPicker({ latitude, longitude, onChange }) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasPoint = latitude !== '' && longitude !== '' && Number.isFinite(lat) && Number.isFinite(lng);

  const handleMapClick = useCallback((e) => {
    onChange(e.lngLat.lat.toFixed(6), e.lngLat.lng.toFixed(6));
  }, [onChange]);

  const initialViewState = hasPoint
    ? { longitude: lng, latitude: lat, zoom: 14 }
    : RANCHI_CENTER;

  return (
    <Box className={styles.wrapper}>
      <Box className={styles.mapFrame}>
        <Map
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={initialViewState}
          mapStyle={MAP_STYLE}
          style={{ width: '100%', height: '100%' }}
          onClick={handleMapClick}
          cursor="crosshair"
        >
          {hasPoint && <Marker longitude={lng} latitude={lat} anchor="center" color="#f59e0b" />}
        </Map>
      </Box>
      <Typography className={styles.hint}>
        Click the map to set a location, or enter coordinates directly.
      </Typography>
      <Box className={styles.coordRow}>
        <TextField
          label="Latitude"
          value={latitude}
          onChange={(e) => onChange(e.target.value, longitude)}
          size="small"
          fullWidth
        />
        <TextField
          label="Longitude"
          value={longitude}
          onChange={(e) => onChange(latitude, e.target.value)}
          size="small"
          fullWidth
        />
      </Box>
    </Box>
  );
}

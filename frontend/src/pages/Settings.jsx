import { useEffect, useState } from 'react';
import { Box, Typography, Card, CardContent, Alert, TextField, Button } from '@mui/material';
import PageHeader from '../components/common/PageHeader';
import Spinner from '../components/common/Spinner';
import { useToast } from '../context/ToastContext';
import {
  getWeights, setWeights as saveWeights,
  getTtl, setTtl, getH3, setH3,
} from '../api/endpoints';
import styles from './Settings.module.css';

const WEIGHT_FIELDS = [
  { key: 'etar', label: 'ETAR', description: 'Speed of arrival at restaurant' },
  { key: 'load', label: 'Load', description: 'Recent deliveries in past 60 min' },
];

// Geo + timing knobs. `key` maps to the geoInputs state; `step`/`min` drive the number input.
const GEO_FIELDS = [
  { key: 'orderTtlSec',        label: 'Order TTL (s)',              min: 1,  step: 1,
    description: 'How long an order waits for a rider before it is cancelled. Applies live.' },
  { key: 'candidateK',        label: 'Candidate-K (rider selection)', min: 0, step: 1,
    description: 'Hex-ring radius searched for riders around a restaurant. Applies live.' },
  { key: 'restaurantServiceK', label: 'Service-K (restaurant selection)', min: 0, step: 1,
    description: 'Hex-ring radius of restaurants shown to a customer. Applies live.' },
  { key: 'resolution',        label: 'H3 resolution',              min: 0,  step: 1,
    description: 'Hexagon grid fineness (0–15). Applies after a simulation restart.' },
];

export default function Settings() {
  const [weights, setWeights]   = useState({ etar: 0.71, load: 0.29 });
  const [inputs, setInputs]     = useState({ etar: '0.71', load: '0.29' });
  const [saving, setSaving]     = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'saved' | 'error' | null

  // Geo + timing config (TTL / H3 resolution / candidate + service K).
  const [geoInputs, setGeoInputs] = useState({
    orderTtlSec: '', candidateK: '', restaurantServiceK: '', resolution: '',
  });
  const [geoSaving, setGeoSaving] = useState(false);

  const toast = useToast();

  useEffect(() => {
    getWeights()
      .then((res) => {
        setWeights(res.data);
        setInputs({
          etar: String(res.data.etar),
          load: String(res.data.load),
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([getTtl(), getH3()])
      .then(([ttlRes, h3Res]) => {
        setGeoInputs({
          orderTtlSec:        String(Math.round((ttlRes.data.orderTtlMs ?? 0) / 1000)),
          candidateK:         String(h3Res.data.candidateK ?? ''),
          restaurantServiceK: String(h3Res.data.restaurantServiceK ?? ''),
          resolution:         String(h3Res.data.resolution ?? ''),
        });
      })
      .catch(() => {});
  }, []);

  const handleGeoChange = (key) => (e) =>
    setGeoInputs((prev) => ({ ...prev, [key]: e.target.value }));

  const handleGeoSave = async () => {
    setGeoSaving(true);
    try {
      await setTtl({ orderTtlMs: Math.round((parseFloat(geoInputs.orderTtlSec) || 0) * 1000) });
      const h3Res = await setH3({
        resolution:         parseInt(geoInputs.resolution, 10),
        candidateK:         parseInt(geoInputs.candidateK, 10),
        restaurantServiceK: parseInt(geoInputs.restaurantServiceK, 10),
      });
      setGeoInputs((prev) => ({
        ...prev,
        candidateK:         String(h3Res.data.candidateK),
        restaurantServiceK: String(h3Res.data.restaurantServiceK),
        resolution:         String(h3Res.data.resolution),
      }));
      toast.success('Geo & timing settings updated');
    } catch (err) {
      toast.error(err.response?.data?.message ?? 'Failed to save geo settings');
    } finally {
      setGeoSaving(false);
    }
  };

  const handleChange = (key) => (e) => {
    setInputs((prev) => ({ ...prev, [key]: e.target.value }));
    setSaveStatus(null);
  };

  const handleSave = async () => {
    const body = {
      etar: parseFloat(inputs.etar) || 0,
      load: parseFloat(inputs.load) || 0,
    };
    if (body.etar + body.load === 0) return;

    setSaving(true);
    try {
      const res = await saveWeights(body);
      const normalized = res.data.weights;
      setWeights(normalized);
      setInputs({
        etar: String(normalized.etar),
        load: String(normalized.load),
      });
      setSaveStatus('saved');
      toast.success('Weights updated');
    } catch {
      setSaveStatus('error');
      toast.error('Failed to save weights');
    }
    setSaving(false);
  };

  return (
    <Box>
      <PageHeader
        title="Settings"
        description="System configuration and allocation parameters."
      />

      <Alert severity="info" className={styles.alert}>
        Weights are auto-normalized to sum to 1 before scoring. Set any positive values and the
        engine will scale them — e.g. 7 / 3 is the same as 0.7 / 0.3.
      </Alert>

      <Typography variant="h6" className={styles.sectionTitle}>Allocation Weights</Typography>

      <div className={styles.weightGrid}>
        {WEIGHT_FIELDS.map(({ key, label, description }) => (
          <Card elevation={0} key={key}>
            <CardContent>
              <Typography variant="body2" className={styles.weightLabel}>{label}</Typography>
              <Typography variant="h4" className={styles.weightValue}>
                {(weights[key] * 100).toFixed(0)}%
              </Typography>
              <Typography variant="body2" className={styles.weightDesc}>{description}</Typography>
              <TextField
                type="number"
                size="small"
                value={inputs[key]}
                onChange={handleChange(key)}
                fullWidth
                className={styles.weightInput}
                inputProps={{ min: 0, step: 0.1 }}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className={styles.saveRow}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          className={styles.saveBtn}
        >
          {saving ? <Spinner size="sm" /> : 'Save weights'}
        </Button>
        {saveStatus === 'saved' && (
          <Typography className={styles.savedText}>Weights updated</Typography>
        )}
        {saveStatus === 'error' && (
          <Typography className={styles.errorText}>Failed to save</Typography>
        )}
      </div>

      <Typography variant="h6" className={styles.sectionTitle}>Geo &amp; Timing</Typography>

      <Alert severity="info" className={styles.alert}>
        TTL and the two K radii apply immediately. Changing the H3 resolution only takes full
        effect after the simulation is restarted (Stop → Start), since riders are indexed into the
        grid when the simulation hydrates.
      </Alert>

      <div className={styles.weightGrid}>
        {GEO_FIELDS.map(({ key, label, description, min, step }) => (
          <Card elevation={0} key={key}>
            <CardContent>
              <Typography variant="body2" className={styles.weightLabel}>{label}</Typography>
              <Typography variant="h4" className={styles.weightValue}>
                {geoInputs[key] === '' ? '—' : geoInputs[key]}
              </Typography>
              <Typography variant="body2" className={styles.weightDesc}>{description}</Typography>
              <TextField
                type="number"
                size="small"
                value={geoInputs[key]}
                onChange={handleGeoChange(key)}
                fullWidth
                className={styles.weightInput}
                inputProps={{ min, step }}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className={styles.saveRow}>
        <Button
          variant="contained"
          onClick={handleGeoSave}
          disabled={geoSaving}
          className={styles.saveBtn}
        >
          {geoSaving ? <Spinner size="sm" /> : 'Save geo & timing'}
        </Button>
      </div>
    </Box>
  );
}

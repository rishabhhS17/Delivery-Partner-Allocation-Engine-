import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Button } from '@mui/material';
import { RefreshCw } from 'lucide-react';
import Map, { Source, Layer, Marker } from 'react-map-gl';
import MarkerLabel from '../components/map/MarkerLabel.jsx';
import RiderMarker from '../components/map/RiderMarker.jsx';
import PageHeader from '../components/common/PageHeader';
import MapPanel from '../components/common/MapPanel';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import { Skeleton } from '../components/common/Skeleton';
import { getOrder } from '../api/endpoints';
import { useSimulation } from '../context/SimulationContext';
import styles from './OrderMap.module.css';

const MAPBOX_TOKEN   = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';
const MAP_STYLE      = 'mapbox://styles/mapbox/dark-v11';
const RANCHI_DEFAULT = { longitude: 85.33, latitude: 23.35, zoom: 13 };

const leg1LineLayer = {
  id:   'order-leg1',
  type: 'line',
  paint: { 'line-color': '#f5a623', 'line-width': 3, 'line-opacity': 0.85 },
};

const leg2LineLayer = {
  id:   'order-leg2',
  type: 'line',
  paint: { 'line-color': '#7928ca', 'line-width': 3, 'line-opacity': 0.85 },
};

// The rider's current leg when they are delivering another (clubbed) order first.
const otherOrderLegLayer = {
  id:   'other-order-leg',
  type: 'line',
  paint: { 'line-color': '#a1a1a1', 'line-width': 3, 'line-opacity': 0.7, 'line-dasharray': [1, 1.5] },
};

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

const riderConnectorLayer = {
  id:   'rider-connector',
  type: 'line',
  paint: {
    'line-color':     ['get', 'color'],
    'line-width':     2,
    'line-opacity':   0.55,
    'line-dasharray': [2, 2.5],
  },
};

export default function OrderMap() {
  const mapRef          = useRef(null);
  const mapContainerRef = useRef(null);
  const { id }          = useParams();
  const [order, setOrder]   = useState(null);
  const [status, setStatus] = useState('loading');
  const { riders, routes }  = useSimulation();

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const observer = new ResizeObserver(() => { mapRef.current?.resize(); });
    observer.observe(mapContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const fetchOrder = () => {
    setStatus('loading');
    getOrder(id)
      .then((res) => {
        setOrder(res.data?.data ?? res.data);
        setStatus('ready');
      })
      .catch(() => {
        setOrder(null);
        setStatus('error');
      });
  };

  useEffect(fetchOrder, [id]);

  // The rider carrying this order — it may not be the order they are heading to right now when
  // they carry more than one (clubbed orders).
  const assignedRider = useMemo(
    () => riders.find((r) => r.orderId === id || r.onboardOrderIds?.includes(id)),
    [riders, id],
  );
  const isRiderOnAnotherOrder = Boolean(assignedRider && assignedRider.orderId && assignedRider.orderId !== id);

  // The leg the rider is on now, toward the other order's stop (decision K7).
  const otherOrderLegGeojson = useMemo(() => {
    if (!isRiderOnAnotherOrder) return EMPTY_GEOJSON;
    const coords = (routes.get(assignedRider.orderId)?.leg1Coords ?? []).slice(assignedRider.legStepIndex ?? 0);
    return coords.length >= 2
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }] }
      : EMPTY_GEOJSON;
  }, [isRiderOnAnotherOrder, assignedRider, routes]);

  const leg1Geojson = useMemo(() => {
    // Only draw a leg when its live rider is present — otherwise a stale/just-delivered order's
    // persisted coords would render an orphaned line with no rider pin on it.
    if (!order || order.status !== 'ASSIGNED' || !assignedRider || isRiderOnAnotherOrder) return EMPTY_GEOJSON;
    const live    = routes.get(id);
    const full    = live?.leg1Coords ?? order.leg1Coords ?? [];
    const stepIdx = assignedRider?.legStepIndex ?? 0;
    const coords  = full.slice(stepIdx);
    return {
      type: 'FeatureCollection',
      features: coords.length >= 2
        ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }]
        : [],
    };
  }, [order, assignedRider, isRiderOnAnotherOrder, routes, id]);

  const leg2Geojson = useMemo(() => {
    if (!order || !assignedRider || isRiderOnAnotherOrder) return EMPTY_GEOJSON;
    const live    = routes.get(id);
    const full    = live?.leg2Coords ?? order.leg2Coords ?? [];
    const stepIdx = order.status === 'PICKED_UP' ? (assignedRider?.legStepIndex ?? 0) : 0;
    const coords  = full.slice(stepIdx);
    return {
      type: 'FeatureCollection',
      features: coords.length >= 2
        ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }]
        : [],
    };
  }, [order, assignedRider, isRiderOnAnotherOrder, routes, id]);

  const riderConnectorGeojson = useMemo(() => {
    if (!assignedRider || !order || isRiderOnAnotherOrder) return EMPTY_GEOJSON;
    let dest, color;
    if (order.status === 'ASSIGNED') {
      dest  = [order.restaurantLng, order.restaurantLat];
      color = '#f5a623';
    } else if (order.status === 'PICKED_UP') {
      dest  = [order.customerLng, order.customerLat];
      color = '#7928ca';
    } else {
      return { type: 'FeatureCollection', features: [] };
    }
    return {
      type: 'FeatureCollection',
      features: [{
        type:       'Feature',
        geometry:   { type: 'LineString', coordinates: [[assignedRider.lng, assignedRider.lat], dest] },
        properties: { color },
      }],
    };
  }, [assignedRider, order, isRiderOnAnotherOrder]);

  const initialView = order
    ? { longitude: order.restaurantLng, latitude: order.restaurantLat, zoom: 13 }
    : RANCHI_DEFAULT;

  return (
    <Box className={styles.pageRoot}>
      <PageHeader
        title="Order Map"
        description="Restaurant, customer, and assigned rider for this delivery."
        action={order && <StatusBadge kind="order" status={order.status} cancelReason={order.cancelReason} />}
      />

      <div className={styles.mapPanelWrap}>
        <MapPanel
          eyebrow={isRiderOnAnotherOrder
            ? `Rider ${assignedRider.name} — Delivering another order first`
            : 'Route — Live remaining path'}
          legend={[
            { label: 'To restaurant', color: 'warning' },
            { label: 'To customer',   color: 'violet'  },
            { label: 'Rider',         color: 'link'    },
            ...(isRiderOnAnotherOrder ? [{ label: 'Rider\'s current leg', color: 'faint' }] : []),
          ]}
          variant="full"
        >
          <div className={styles.mapWrap} ref={mapContainerRef}>
            {status === 'loading' && <Skeleton shape="block" />}

            {status === 'error' && (
              <EmptyState
                title="Could not load this order"
                description="The backend isn't reachable yet — this will resolve once it's live."
                action={
                  <Button size="small" variant="outlined" startIcon={<RefreshCw size={14} />} onClick={fetchOrder}>
                    Retry
                  </Button>
                }
              />
            )}

            {status === 'ready' && (
              <Map
                ref={mapRef}
                mapboxAccessToken={MAPBOX_TOKEN}
                initialViewState={initialView}
                mapStyle={MAP_STYLE}
                style={{ width: '100%', height: '100%' }}
              >
                <Source id="order-leg1" type="geojson" data={leg1Geojson}>
                  <Layer {...leg1LineLayer} />
                </Source>
                <Source id="order-leg2" type="geojson" data={leg2Geojson}>
                  <Layer {...leg2LineLayer} />
                </Source>
                <Source id="rider-connector" type="geojson" data={riderConnectorGeojson}>
                  <Layer {...riderConnectorLayer} />
                </Source>
                <Source id="other-order-leg" type="geojson" data={otherOrderLegGeojson}>
                  <Layer {...otherOrderLegLayer} />
                </Source>

                {order && (
                  <Marker longitude={order.restaurantLng} latitude={order.restaurantLat} anchor="center">
                    <div className={styles.markerWrap}>
                      <MarkerLabel label={order.restaurantName ?? 'Restaurant'} />
                      <div className={styles.pinRestaurant} />
                    </div>
                  </Marker>
                )}

                {order && (
                  <Marker longitude={order.customerLng} latitude={order.customerLat} anchor="center">
                    <div className={styles.markerWrap}>
                      <MarkerLabel label={order.customerName ?? 'Customer'} />
                      <div className={styles.pinCustomer} />
                    </div>
                  </Marker>
                )}

                {assignedRider && (
                  <Marker longitude={assignedRider.lng} latitude={assignedRider.lat} anchor="center">
                    <div className={styles.markerWrap}>
                      {isRiderOnAnotherOrder && <MarkerLabel label="Delivering another order first" />}
                      <RiderMarker rider={assignedRider} />
                    </div>
                  </Marker>
                )}
              </Map>
            )}
          </div>
        </MapPanel>
      </div>
    </Box>
  );
}

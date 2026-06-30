import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Box } from '@mui/material';
import MapGL, { Source, Layer, Marker } from 'react-map-gl';
import PageHeader from '../components/common/PageHeader';
import MapPanel from '../components/common/MapPanel';
import LiveDot from '../components/common/LiveDot';
import { addLabelPillImage, makeLabelLayer } from '../components/map/mapLabels.js';
import RiderMarker from '../components/map/RiderMarker.jsx';
import OrderMarker from '../components/map/OrderMarker.jsx';
import { useSimulation } from '../context/SimulationContext';
import { getOrders, getRestaurants } from '../api/endpoints';
import styles from './OrdersMap.module.css';

const MAPBOX_TOKEN  = import.meta.env.VITE_MAPBOX_TOKEN || '';
const RANCHI_CENTER = { longitude: 85.33, latitude: 23.35, zoom: 12 };
const MAP_STYLE     = 'mapbox://styles/mapbox/dark-v11';
const POLL_MS       = 10_000;

const leg1LineLayer = {
  id:   'leg1-routes',
  type: 'line',
  paint: { 'line-color': '#22c55e', 'line-width': 2.5, 'line-opacity': 0.8 },
};

const leg2LineLayer = {
  id:   'leg2-routes',
  type: 'line',
  paint: { 'line-color': '#06b6d4', 'line-width': 2.5, 'line-opacity': 0.8 },
};

const restaurantLayer = {
  id:   'map-restaurants',
  type: 'circle',
  paint: {
    'circle-radius':       4,
    'circle-color':        '#22c55e',
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 1,
    'circle-opacity':      0.75,
  },
};

const restaurantLabelLayer = makeLabelLayer({
  id:        'map-restaurants-labels',
  source:    'map-restaurants',
  textField: ['coalesce', ['get', 'name'], 'Restaurant'],
  minZoom:   13,
});

export default function OrdersMap() {
  const mapRef          = useRef(null);
  const mapContainerRef = useRef(null);
  const { riders, routes, connected } = useSimulation();
  const [orders, setOrders]           = useState([]);
  const [restaurants, setRestaurants] = useState([]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const observer = new ResizeObserver(() => { mapRef.current?.resize(); });
    observer.observe(mapContainerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    getRestaurants()
      .then((r) => setRestaurants(r.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const load = () =>
      getOrders()
        .then((r) => setOrders(r.data ?? []))
        .catch(() => {});
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) addLabelPillImage(map);
  }, []);

  const activeOrders = useMemo(
    () => orders.filter((o) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED'),
    [orders],
  );

  const riderByOrder = useMemo(() => {
    const map = new Map();
    for (const r of riders) {
      if (r.orderId) map.set(r.orderId, r);
    }
    return map;
  }, [riders]);

  const pendingOrders = useMemo(
    () => activeOrders.filter((o) => o.status === 'PENDING'),
    [activeOrders],
  );

  const customerOrders = useMemo(
    () => activeOrders.filter(
      (o) => o.status !== 'PENDING' && o.customerLng != null && o.customerLat != null,
    ),
    [activeOrders],
  );

  const inTransit = useMemo(
    () => activeOrders.filter((o) => o.status === 'ASSIGNED' || o.status === 'PICKED_UP').length,
    [activeOrders],
  );

  const leg1Geojson = useMemo(() => {
    const features = [];
    for (const o of activeOrders) {
      if (o.status !== 'ASSIGNED') continue;
      const live    = routes.get(o._id?.toString());
      const full    = live?.leg1Coords ?? o.leg1Coords ?? [];
      const rider   = riderByOrder.get(o._id?.toString());
      const stepIdx = rider?.legStepIndex ?? 0;
      const coords  = full.slice(stepIdx);
      if (coords.length >= 2) {
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
      }
    }
    return { type: 'FeatureCollection', features };
  }, [activeOrders, routes, riderByOrder]);

  const leg2Geojson = useMemo(() => {
    const features = [];
    for (const o of activeOrders) {
      if (o.status !== 'PICKED_UP') continue;
      const live    = routes.get(o._id?.toString());
      const full    = live?.leg2Coords ?? o.leg2Coords ?? [];
      const rider   = riderByOrder.get(o._id?.toString());
      const stepIdx = rider?.legStepIndex ?? 0;
      const coords  = full.slice(stepIdx);
      if (coords.length >= 2) {
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
      }
    }
    return { type: 'FeatureCollection', features };
  }, [activeOrders, routes, riderByOrder]);

  const restaurantGeojson = useMemo(() => ({
    type: 'FeatureCollection',
    features: restaurants
      .filter((r) => r.isActive !== false)
      .map((r) => ({
        type:     'Feature',
        geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] },
        properties: { name: r.name ?? '' },
      })),
  }), [restaurants]);

  const eyebrow = (
    <span className={styles.liveEyebrow}>
      <LiveDot active={connected} />
      {connected
        ? `Orders — Live · ${pendingOrders.length} pending · ${inTransit} in transit`
        : 'Orders — Waiting for simulation…'}
    </span>
  );

  return (
    <Box className={styles.pageRoot}>
      <PageHeader
        title="Order Map"
        description="Live view of all active orders, pending queue, delivery routes, and rider positions."
      />

      <div className={styles.mapPanelWrap}>
        <MapPanel
          eyebrow={eyebrow}
          legend={[
            { label: 'Rider',          color: 'link'       },
            { label: 'Pending order',  color: 'warning'    },
            { label: 'In transit',     color: 'violet'     },
            { label: 'To restaurant',  color: 'restaurant' },
            { label: 'To customer',    color: 'customer'   },
          ]}
          variant="full"
        >
          <div className={styles.mapWrap} ref={mapContainerRef}>
            <MapGL
              ref={mapRef}
              mapboxAccessToken={MAPBOX_TOKEN}
              initialViewState={RANCHI_CENTER}
              mapStyle={MAP_STYLE}
              style={{ width: '100%', height: '100%' }}
              onLoad={handleLoad}
            >
              <Source id="leg1-routes" type="geojson" data={leg1Geojson}>
                <Layer {...leg1LineLayer} />
              </Source>
              <Source id="leg2-routes" type="geojson" data={leg2Geojson}>
                <Layer {...leg2LineLayer} />
              </Source>
              <Source id="map-restaurants" type="geojson" data={restaurantGeojson}>
                <Layer {...restaurantLayer} />
                <Layer {...restaurantLabelLayer} />
              </Source>

              {/* Pending orders at restaurant pickup point */}
              {pendingOrders
                .filter((o) => o.restaurantLng != null && o.restaurantLat != null)
                .map((o) => (
                  <Marker key={`pending-${o._id}`} longitude={o.restaurantLng} latitude={o.restaurantLat} anchor="center">
                    <OrderMarker order={o} />
                  </Marker>
                ))
              }

              {/* In-transit orders at customer drop-off point */}
              {customerOrders.map((o) => (
                <Marker key={`customer-${o._id}`} longitude={o.customerLng} latitude={o.customerLat} anchor="center">
                  <OrderMarker order={o} />
                </Marker>
              ))}

              {/* Riders — rendered last so they appear above order markers */}
              {riders.map((r) => (
                <Marker key={r._id} longitude={r.lng} latitude={r.lat} anchor="center">
                  <RiderMarker rider={r} />
                </Marker>
              ))}
            </MapGL>
          </div>
        </MapPanel>
      </div>
    </Box>
  );
}

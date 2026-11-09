# ADR-0003: Supervivencia ante Políticas de Batería (OEM Killers), Partial WakeLocks y Monitoreo Heartbeat

El Dispositivo Centinela garantiza la ejecución continua de la intercepción coordinando el NotificationListenerService con un Foreground Service persistente, adquisición efímera de Partial WakeLock (15s) en captura, exclusión de optimización de batería y telemetría periódica mediante Heartbeats cada 5 minutos hacia el backend.

## Status
Accepted

## Context
Los fabricantes de dispositivos Android populares en Colombia (Xiaomi, Samsung, Huawei, Motorola) aplican optimizaciones agresivas de batería y modos Doze que congelan sockets de red y matan procesos en background de manera arbitraria cuando la pantalla permanece apagada en el mostrador del comercio. Sin medidas activas, el servicio de escucha deja de recibir eventos o no puede transmitir los Webhooks.

## Decision
1. **Foreground Service Coordinado:** El `NotificationListenerService` nativo se apoya en un servicio de primer plano (`Foreground Service`) con notificación visible e inextinguible en la barra de estado (*"TransferYA Centinela Activo"*), garantizando la máxima prioridad en el planificador de procesos de Android (`oom_score_adj`).
2. **Exención de Batería:** El proceso de onboarding del dispositivo exige la concesión del permiso `android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` para evitar suspensión en Doze.
3. **Partial WakeLock Efímero:** En el instante en que el sistema operativo entrega el callback de la notificación, el servicio adquiere un `PowerManager.WakeLock` de tipo `PARTIAL_WAKE_LOCK` con timeout forzado de 15 segundos para asegurar que la CPU permanezca activa hasta persistir en Room y gatillar el envío de red.
4. **Heartbeat y Detección de Dispositivo Caído:** El Dispositivo Centinela despacha una petición liviana de salud cada 5 minutos al backend (`/api/v1/devices/heartbeat`). Si el backend detecta una ventana de inactividad superior a 10 minutos, dispara una alerta de contingencia al WhatsApp del propietario del comercio.

## Consequences
- **Positivas:** Inmunidad contra suspensión de red y matanza de procesos por el OS. Visibilidad operativa inmediata si el dispositivo es desconectado, apagado o desconfigurado accidentalmente.
- **Trade-offs:** Incremento leve en consumo energético (mitigado al tratarse de un dispositivo que permanece conectado al cargador en el punto de venta) y necesidad de permisos especiales en Android.


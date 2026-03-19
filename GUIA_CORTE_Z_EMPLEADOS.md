# Guía para empleados: cómo llenar el Corte Z en FST Mercado

Esta guía explica, en español simple, cómo capturar el `Corte Z` en la app y qué información va en cada sección.

## Objetivo del Corte Z
El Corte Z sirve para:
- reportar el efectivo contado del día
- registrar retiros a bóveda y otros movimientos de caja
- comparar el efectivo entregado contra el `Arqueo de efectivo en comprobante Versatil`
- detectar `sobrante` o `faltante`

## Secciones obligatorias y opcionales

### Secciones obligatorias
- `Datos clave`
- `Datos generales del corte`
- `Datos del ticket POS`
- `Arqueo físico`
- `Conciliación automática`

### Secciones opcionales o según el caso
- `Desglose de venta por producto (Opcional)`
- `Retiros a bóveda (solo si hubo retiros)`
- `Controles adicionales del cajero (solo llena lo que sí haya ocurrido)`

## Regla principal
El Corte Z compara:
- `Efectivo contado en caja`
- más `Retiros a bóveda`
- contra `Arqueo de efectivo en comprobante Versatil`

Importante:
- `Fondo de caja inicial` es informativo y no genera faltante ni sobrante por sí solo.
- `Transferencias identificadas` no cuentan como efectivo.
- `Ventas facturadas` se registran para control, pero no cambian automáticamente la diferencia.

## Orden recomendado para llenarlo
Llena el Corte Z en este orden:
1. `Total del ticket`
2. `Arqueo de efectivo en comprobante Versatil`
3. `Datos generales del corte`
4. `Datos del ticket POS`
5. `Arqueo físico`
6. `Retiros a bóveda`
7. `Controles adicionales del cajero`
8. Revisa `Conciliación automática`
9. Guarda el Corte Z

## 1. Datos clave (Obligatorio)
En la parte superior verás dos campos grandes.

### Total del ticket (Obligatorio)
Aquí va el total general del ticket POS del día.

### Arqueo de efectivo en comprobante Versatil (Obligatorio)
Aquí va el monto de efectivo que aparece en el comprobante de Versatil.

Este campo es muy importante porque contra este valor se compara el efectivo entregado.

## 2. Datos generales del corte (Obligatorio)

### Fecha del negocio (Obligatorio)
Pon la fecha del día que se está cerrando.

### Sucursal (Obligatorio)
Normalmente ya aparecerá la sucursal principal.

### Tipo de corte (Obligatorio)
Normalmente será `Corte Z`.

### Folio corte (Opcional)
Si se usa un folio interno, captúralo aquí.

### Inicio corte (Obligatorio)
Hora o fecha-hora en que inició la operación del corte.

### Fin corte (Obligatorio)
Hora o fecha-hora en que terminó la operación del corte.

### Empleado / Cajero (Obligatorio)
Selecciona al empleado correcto.

### Cajero sistema (Obligatorio)
Nombre que aparece en sistema o la persona que operó caja.

### Clientes atendidos (Opcional)
Número de clientes atendidos ese día, si se tiene ese dato.

### Folio inicio tickets (Obligatorio)
Primer folio del período.

### Folio fin tickets (Obligatorio)
Último folio del período.

### Entregado por (Obligatorio)
Persona que entrega el corte.

### Recibido por (Opcional)
Persona que recibe el corte.

### Observaciones (Opcional)
Aquí puedes poner cualquier nota importante del día.

## 3. Datos del ticket POS (Obligatorio)

### Factura global / venta (Obligatorio)
Monto de factura global o venta total según el ticket POS.

### Suma de recibos contado (Obligatorio)
Total de ventas de contado.

### Reembolso recibos (Obligatorio si hubo reembolsos)
Total de reembolsos o devoluciones del día.

Nota:
- este dato también alimenta automáticamente `Reembolsos del día` en controles adicionales

### Ventas a crédito facturadas (Obligatorio)
Captura el total facturado a crédito.

Si no hubo, escribe `0`.

### Ventas en efectivo facturadas (Obligatorio)
Captura el total facturado pagado en efectivo.

Si no hubo, escribe `0`.

### Total de ventas facturadas (Automático)
La app lo calcula automáticamente sumando:
- `Ventas a crédito facturadas`
- `Ventas en efectivo facturadas`

Importante:
- este total ya no se captura manualmente
- es informativo y no cambia la diferencia del corte

### Venta neta de contado (Automático)
La app lo calcula a partir de contado menos reembolsos.

### Ventas moneda nacional (Opcional)
Ventas en MXN.

### Ventas dólar (USD) (Opcional)
Ventas cobradas en USD.

### Tipo de cambio (Obligatorio si hubo USD)
Tipo de cambio del día.

### Ventas dólar en MXN (Automático)
La app lo calcula automáticamente.

### IVA 0% (Opcional)
Monto de IVA 0 si aplica.

## 4. Desglose de venta por producto (Opcional)
Esta sección es opcional.

Se usa solo si quieren registrar cómo se repartió la venta entre productos.

### Producto
Nombre del producto, por ejemplo:
- Sandía
- Papaya
- Piña

### Importe
Monto vendido de ese producto.

### Participación
La app lo calcula automáticamente con base en `Total del ticket`.

### Notas
Observación breve del producto, si hace falta.

Si no tienen esta información, pueden dejar esta sección vacía.

## 5. Arqueo físico (Obligatorio)
Aquí se captura el dinero físico que realmente se contó.

### Arqueo MXN - Billetes (Obligatorio si hay billetes MXN)
En `Cantidad` pon cuántas piezas hay de cada denominación:
- 1000
- 500
- 200
- 100
- 50
- 20

Ejemplo:
- si hay 3 billetes de 500, en la fila de 500 se captura `3`

### Arqueo MXN - Monedas (Obligatorio si hay monedas MXN)
En `Cantidad` pon cuántas monedas hay de cada denominación.

### Arqueo USD (Obligatorio si hay efectivo en USD)
En `Cantidad` pon cuántas piezas hay de cada denominación en dólares.

La app calcula automáticamente:
- total por fila
- total MXN
- total USD
- USD en MXN
- efectivo contado en caja

## 6. Retiros a bóveda (Opcional, solo si hubo retiros)
Esta sección va inmediatamente después del arqueo físico.

Aquí se captura el dinero que fue retirado de la caja y guardado en bóveda o en sobre durante el día.

Importante:
- sí cuenta como parte del corte entregado
- no se descuenta del corte
- no genera faltante por sí solo

### Cómo llenar un retiro a bóveda
Cada retiro puede incluir:
- `Referencia / sobre (Opcional)`
- `Observación (Opcional)`
- desglose por denominación

Dentro de cada tabla:
- en `Cantidad` pon cuántas piezas van en ese retiro
- la app calcula el total automáticamente

Se puede llenar:
- `Bóveda MXN - Billetes`
- `Bóveda MXN - Monedas`
- `Bóveda USD`

### Agregar retiro a bóveda adicional
Si hubo más de un retiro, usa:
- `Agregar retiro a bóveda adicional`

La app mostrará:
- total por cada retiro
- `Total retiros a bóveda` al final de la sección

## 7. Controles adicionales del cajero (Parcialmente opcional)
Esta sección registra movimientos de control.

Importante:
- no todos los campos aquí se llenan manualmente
- algunos son informativos o se calculan solos

### Fondo de caja inicial (Informativo)
Es informativo.

Normalmente será:
- `1000`

No genera faltante ni sobrante por sí solo.

### Reembolsos del día (Automático)
Se llena automáticamente desde `Reembolso recibos`.

No se captura manualmente aquí.

### Gastos pagados con caja (Opcional, solo si hubo gasto)
Captura aquí gastos pagados en efectivo desde la caja.

Ejemplos:
- salarios
- cajas
- insumos
- limpieza

### Retiros a bóveda (Informativo)
Es informativo en esta sección.

El monto viene automáticamente de la sección `Retiros a bóveda`.

No se captura manualmente aquí.

### Depósitos / retiros parciales (Opcional, solo si hubo movimiento)
Captura movimientos como depósitos de tarimas o bines, o salidas parciales si aplica.

### Vales / comprobantes (Opcional)
Captúralos solo si realmente se usaron.

### Cheques (Opcional)
Captúralos solo si realmente se usaron.

### Transferencias identificadas (Opcional, solo si hubo transferencia)
Aquí van transferencias bancarias verificadas del día.

Importante:
- se registran para control
- no cuentan como efectivo físico
- no aumentan el efectivo entregado

### Otros ajustes (+/-) (Opcional)
Aquí va cualquier ajuste adicional que no entre en los conceptos anteriores.

## 8. Conciliación automática (Automático)
Esta sección se calcula sola.

Aquí verás:
- efectivo contado MXN
- USD contado
- USD contado en MXN
- efectivo contado en caja
- fondo de caja inicial
- retiros a bóveda
- total efectivo entregado
- arqueo efectivo Versatil
- esperado calculado
- ajustes que afectan efectivo
- transferencias identificadas
- diferencia vs Versatil

### Cómo interpretar la diferencia
- `Sin diferencia`: todo cuadra
- `Sobrante`: hay más efectivo entregado que el reportado en Versatil
- `Faltante`: hay menos efectivo entregado que el reportado en Versatil

## 9. Antes de guardar
Revisa esta lista rápida:
- `Total del ticket` está capturado
- `Arqueo de efectivo en comprobante Versatil` está capturado
- `Factura global / venta` está capturada
- `Ventas a crédito facturadas` está capturada, aunque sea `0`
- `Ventas en efectivo facturadas` está capturada, aunque sea `0`
- `Folio inicio tickets` está capturado
- `Folio fin tickets` está capturado
- `Entregado por` está capturado
- el arqueo físico tiene cantidades correctas
- si hubo retiros a bóveda, están capturados en su sección
- si hubo reembolsos, el monto coincide con el POS
- si hubo transferencias, están registradas para control

## 10. Después de guardar
Una vez enviado el Corte Z:
- revisa el mensaje de éxito
- si eres empleado, llena todo con calma antes de enviar
- si tienes duda, avisa antes de volver a capturarlo

## Errores comunes

### Error 1: Capturar retiros a bóveda en controles adicionales
No.

Los `Retiros a bóveda` se capturan en su sección propia con desglose de billetes y monedas.

### Error 2: Pensar que el fondo inicial genera faltante
No.

El `Fondo de caja inicial` es informativo y no debe provocar faltante automáticamente.

### Error 3: Contar transferencias como efectivo
No.

Las transferencias se registran, pero no cuentan como efectivo físico.

### Error 4: No llenar Versatil
Si falta `Arqueo de efectivo en comprobante Versatil`, no se puede revisar correctamente la diferencia.

### Error 5: Dejar en blanco ventas facturadas porque no hubo
No las dejes en blanco.

Si no hubo ventas facturadas a crédito o en efectivo, captura `0`.

## Ejemplo rápido
Supongamos:
- efectivo contado en caja: `3000`
- retiros a bóveda: `1500`
- Versatil: `4500`

Entonces:
- total efectivo entregado = `4500`
- diferencia = `0`

Eso significa que el corte cuadra correctamente.

## Regla final para el equipo
Si no están seguros de dónde va algo:
1. si es dinero físico contado en caja, va en `Arqueo físico`
2. si es dinero retirado y guardado en sobre o bóveda, va en `Retiros a bóveda`
3. si es un movimiento de control, va en `Controles adicionales del cajero`
4. si es transferencia bancaria, se registra, pero no se cuenta como efectivo

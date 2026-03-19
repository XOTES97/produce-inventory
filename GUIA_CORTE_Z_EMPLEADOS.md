# Guia para Empleados: Como llenar el Corte Z en FST Mercado

Esta guia explica, en palabras simples, como capturar el `Corte Z` en la app y que informacion va en cada seccion.

Objetivo del Corte Z:
- reportar el efectivo contado del dia
- registrar retiros a bóveda y otros movimientos de caja
- comparar el total entregado contra el `Arqueo de efectivo en comprobante Versatil`
- detectar `sobrante` o `faltante`

## Secciones obligatorias y opcionales

### Secciones obligatorias
- `Datos clave`
- `Datos generales del corte`
- `Datos del ticket POS`
- `Arqueo fisico`
- `Conciliacion automatica`

### Secciones opcionales o segun el caso
- `Desglose de venta por producto (Opcional)`
- `Retiros a bóveda (solo si hubo retiros)`
- `Controles adicionales del cajero (solo llena lo que si haya ocurrido)`

## Regla principal
El Corte Z compara:

- `Efectivo contado en caja`
- mas `Retiros a bóveda`
- contra `Arqueo de efectivo en comprobante Versatil`

Importante:
- `Fondo de caja inicial` no genera faltante ni sobrante por si solo
- `Transferencias identificadas` no cuentan como efectivo
- `Ventas facturadas` se registran para control, pero no cambian automaticamente la diferencia

## Orden recomendado para llenarlo
Llena el Corte Z en este orden:

1. `Total del ticket`
2. `Arqueo de efectivo en comprobante Versatil`
3. `Datos generales del corte`
4. `Datos del ticket POS`
5. `Arqueo fisico`
6. `Retiros a bóveda`
7. `Controles adicionales del cajero`
8. Revisa `Conciliacion automatica`
9. Guarda el Corte Z

## 1. Datos clave (Obligatorio)
En la parte superior veras dos campos grandes.

### Total del ticket (Obligatorio)
Aqui va el total general del ticket POS del dia.

### Arqueo de efectivo en comprobante Versatil (Obligatorio)
Aqui va el monto de efectivo que aparece en el comprobante de Versatil.

Este campo es muy importante porque contra este valor se compara el efectivo entregado.

## 2. Datos generales del corte (Obligatorio)

### Fecha del negocio (Obligatorio)
Pon la fecha del dia que se esta cerrando.

### Sucursal (Obligatorio)
Normalmente ya aparecera la sucursal principal.

### Tipo de corte (Obligatorio)
Normalmente sera `Corte Z`.

### Folio corte (Opcional)
Si se usa un folio interno, capturalo aqui.

### Inicio corte (Obligatorio)
Hora o fecha-hora en que inicio la operacion del corte.

### Fin corte (Obligatorio)
Hora o fecha-hora en que termino la operacion del corte.

### Empleado / Cajero (Obligatorio)
Selecciona al empleado correcto.

### Cajero sistema (Obligatorio)
Nombre que aparece en sistema o la persona que opero caja.

### Clientes atendidos (Opcional)
Numero de clientes atendidos ese dia, si se tiene ese dato.

### Folio inicio tickets (Opcional)
Primer folio del periodo.

### Folio fin tickets (Opcional)
Ultimo folio del periodo.

### Entregado por (Obligatorio)
Persona que entrega el corte.

### Recibido por (Opcional)
Persona que recibe el corte.

### Observaciones (Opcional)
Aqui puedes poner cualquier nota importante del dia.

## 3. Datos del ticket POS (Obligatorio)

### Factura global / venta (Opcional)
Monto de factura global o venta total segun el ticket POS.

### Suma de recibos contado (Obligatorio)
Total de ventas de contado.

### Reembolso recibos (Obligatorio si hubo reembolsos)
Total de reembolsos o devoluciones del dia.

Nota:
- este dato tambien alimenta automaticamente `Reembolsos del dia` en controles adicionales

### Ventas a credito facturadas (Opcional)
Ventas facturadas a credito.

### Ventas en efectivo facturadas (Opcional)
Ventas facturadas pagadas en efectivo.

### Total de ventas facturadas (Opcional)
Total facturado general.

Control importante:
- `Ventas a credito facturadas + Ventas en efectivo facturadas` debe ser igual a `Total de ventas facturadas`
- si no coincide, la app mostrara una advertencia

### Venta neta de contado (Automatico)
La app lo calcula a partir de contado menos reembolsos.

### Ventas moneda nacional (Opcional)
Ventas en MXN.

### Ventas dolar (USD) (Opcional)
Ventas cobradas en USD.

### Tipo de cambio (Obligatorio si hubo USD)
Tipo de cambio del dia.

### Ventas dolar en MXN (Automatico)
La app lo calcula automaticamente.

### IVA 0% (Opcional)
Monto de IVA 0 si aplica.

## 4. Desglose de venta por producto (Opcional)
Esta seccion es opcional.

Se usa solo si quieren registrar como se repartio la venta entre productos.

### Producto
Nombre del producto, por ejemplo:
- Sandia
- Papaya
- Piña

### Importe
Monto vendido de ese producto.

### Participacion
La app lo calcula automaticamente con base en `Total del ticket`.

### Notas
Observacion breve del producto, si hace falta.

Si no tienen esta informacion, pueden dejar esta seccion vacia.

## 5. Arqueo fisico (Obligatorio)
Aqui se captura el dinero fisico que realmente se conto.

### Arqueo MXN - Billetes (Obligatorio si hay billetes MXN)
En `Cantidad` pon cuantas piezas hay de cada denominacion:
- 1000
- 500
- 200
- 100
- 50
- 20

Ejemplo:
- si hay 3 billetes de 500, en la fila de 500 se captura `3`

### Arqueo MXN - Monedas (Obligatorio si hay monedas MXN)
En `Cantidad` pon cuantas monedas hay de cada denominacion.

### Arqueo USD (Obligatorio si hay efectivo en USD)
En `Cantidad` pon cuantas piezas hay de cada denominacion en dolares.

La app calcula automaticamente:
- total por fila
- total MXN
- total USD
- USD en MXN
- efectivo contado en caja

## 6. Retiros a bóveda (Opcional, solo si hubo retiros)
Esta seccion va inmediatamente despues del arqueo fisico.

Aqui se captura el dinero que fue retirado de la caja y guardado en bóveda o en sobre durante el dia.

Importante:
- si cuenta como parte del corte entregado
- no se descuenta del corte
- no genera faltante por si solo

### Como llenar un retiro a bóveda
Cada retiro puede incluir:
- `Referencia / sobre (Opcional)`
- `Observacion (Opcional)`
- desglose por denominacion

Dentro de cada tabla:
- en `Cantidad` pon cuantas piezas van en ese retiro
- la app calcula el total automaticamente

Se puede llenar:
- `Bóveda MXN - Billetes`
- `Bóveda MXN - Monedas`
- `Bóveda USD`

### Agregar retiro a bóveda adicional
Si hubo mas de un retiro, usa:
- `Agregar retiro a bóveda adicional`

La app mostrara:
- total por cada retiro
- `Total retiros a bóveda` al final de la seccion

## 7. Controles adicionales del cajero (Parcialmente opcional)
Esta seccion registra movimientos de control.

Importante:
- no todos los campos aqui se llenan manualmente
- algunos son informativos o se calculan solos

### Fondo de caja inicial (Informativo)
Es informativo.

Normalmente sera:
- `1000`

No genera faltante ni sobrante por si solo.

### Reembolsos del dia (Automatico)
Se llena automaticamente desde `Reembolso recibos`.

No se captura manualmente aqui.

### Gastos pagados con caja (Opcional, solo si hubo gasto)
Captura aqui gastos pagados en efectivo desde la caja.

Ejemplos:
- salarios
- cajas
- insumos
- limpieza

### Retiros a bóveda (Informativo)
Es informativo en esta seccion.

El monto viene automaticamente de la seccion `Retiros a bóveda`.

No se captura manualmente aqui.

### Depositos / retiros parciales (Opcional, solo si hubo movimiento)
Captura movimientos como depositos de tarimas o bines, o salidas parciales si aplica.

### Vales / comprobantes (Opcional)
Capturalos solo si realmente se usaron.

### Cheques (Opcional)
Capturalos solo si realmente se usaron.

### Transferencias identificadas (Opcional, solo si hubo transferencia)
Aqui van transferencias bancarias verificadas del dia.

Importante:
- se registran para control
- no cuentan como efectivo fisico
- no aumentan el efectivo entregado

### Otros ajustes (+/-) (Opcional)
Aqui va cualquier ajuste adicional que no entre en los conceptos anteriores.

## 8. Conciliacion automatica (Automatico)
Esta seccion se calcula sola.

Aqui veras:
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

### Como interpretar la diferencia
- `Sin diferencia`: todo cuadra
- `Sobrante`: hay mas efectivo entregado que el reportado en Versatil
- `Faltante`: hay menos efectivo entregado que el reportado en Versatil

## 9. Antes de guardar
Revisa esta lista rapida:

- `Total del ticket` esta capturado
- `Arqueo de efectivo en comprobante Versatil` esta capturado
- el arqueo fisico tiene cantidades correctas
- si hubo retiros a bóveda, estan capturados en su seccion
- si hubo reembolsos, el monto coincide con el POS
- si hubo transferencias, estan registradas para control
- si llenaste `Ventas facturadas`, revisa que:
  - credito + efectivo = total facturado

## 10. Despues de guardar
Una vez enviado el Corte Z:
- revisa el mensaje de exito
- si eres empleado, llena todo con calma antes de enviar
- si tienes duda, avisa antes de volver a capturarlo

## Errores comunes

### Error 1: Capturar retiros a bóveda en controles adicionales
No.

Los `Retiros a bóveda` se capturan en su seccion propia con desglose de billetes y monedas.

### Error 2: Pensar que el fondo inicial genera faltante
No.

El `Fondo de caja inicial` es informativo y no debe provocar faltante automaticamente.

### Error 3: Contar transferencias como efectivo
No.

Las transferencias se registran, pero no cuentan como efectivo fisico.

### Error 4: No llenar Versatil
Si falta `Arqueo de efectivo en comprobante Versatil`, no se puede revisar correctamente la diferencia.

## Ejemplo rapido

Supongamos:
- efectivo contado en caja: `3000`
- retiros a bóveda: `1500`
- Versatil: `4500`

Entonces:
- total efectivo entregado = `4500`
- diferencia = `0`

Eso significa que el corte cuadra correctamente.

## Regla final para el equipo
Si no estan seguros de donde va algo:

1. si es dinero fisico contado en caja, va en `Arqueo fisico`
2. si es dinero retirado y guardado en sobre o bóveda, va en `Retiros a bóveda`
3. si es un movimiento de control, va en `Controles adicionales del cajero`
4. si es transferencia bancaria, se registra, pero no se cuenta como efectivo

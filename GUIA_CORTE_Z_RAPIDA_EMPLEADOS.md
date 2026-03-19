# Guía rápida Corte Z para empleados

Usa esta versión corta cuando solo necesites recordar qué llenar y en qué orden.

## Orden recomendado
1. `Total del ticket`
2. `Arqueo de efectivo en comprobante Versatil`
3. `Datos generales del corte`
4. `Datos del ticket POS`
5. `Arqueo físico`
6. `Retiros a bóveda` si hubo
7. `Controles adicionales del cajero`
8. `Conciliación automática`
9. Guardar Corte Z

## Secciones obligatorias
- `Datos clave`
- `Datos generales del corte`
- `Datos del ticket POS`
- `Arqueo físico`
- `Conciliación automática`

## Secciones opcionales o según el caso
- `Desglose de venta por producto (Opcional)`
- `Retiros a bóveda` solo si hubo retiros
- `Controles adicionales del cajero` solo llena los conceptos que sí existieron

## Campos que no deben quedar en blanco
- `Total del ticket`
- `Arqueo de efectivo en comprobante Versatil`
- `Factura global / venta`
- `Ventas a crédito facturadas`
- `Ventas en efectivo facturadas`
- `Folio inicio tickets`
- `Folio fin tickets`
- `Entregado por`

Si alguna venta facturada no aplica, captura `0`.

## Qué poner en cada sección

### Datos clave
- `Total del ticket`: total general del ticket POS
- `Arqueo de efectivo en comprobante Versatil`: efectivo reportado por Versatil

### Datos generales del corte
- fecha
- empleado / cajero
- inicio y fin
- folio inicio tickets
- folio fin tickets
- entregado por
- demás datos del corte

### Datos del ticket POS
- factura global / venta
- contado
- reembolsos
- ventas facturadas
- USD y tipo de cambio si aplica

### Total de ventas facturadas
- ya no se captura manualmente
- la app lo calcula sola con:
  - `Ventas a crédito facturadas`
  - `Ventas en efectivo facturadas`
- es informativo y no cambia el faltante o sobrante

### Arqueo físico
- cuenta billetes MXN
- cuenta monedas MXN
- cuenta USD si hubo
- captura solo cantidades

### Retiros a bóveda
- captúralos solo si de verdad hubo retiro
- sí forman parte del efectivo entregado
- usa `Agregar retiro a bóveda adicional` si hubo más de uno

### Controles adicionales del cajero
- `Fondo de caja inicial`: informativo
- `Reembolsos del día`: automático
- `Retiros a bóveda`: informativo
- `Gastos`, `Depósitos / retiros parciales`, `Vales`, `Cheques`, `Transferencias`, `Otros ajustes`: solo si ocurrieron

## Reglas clave
- `Fondo de caja inicial` no debe generar faltante por sí solo
- `Transferencias identificadas` no cuentan como efectivo
- `Retiros a bóveda` sí cuentan como parte del corte entregado
- `Total de ventas facturadas` se calcula automáticamente
- si no hubo ventas facturadas en uno de los dos conceptos, captura `0`

## Revisión final
Antes de guardar confirma:
- ya capturaste `Total del ticket`
- ya capturaste `Versatil`
- ya capturaste `Factura global / venta`
- ya capturaste `Ventas a crédito facturadas`
- ya capturaste `Ventas en efectivo facturadas`
- ya capturaste `Folio inicio tickets`
- ya capturaste `Folio fin tickets`
- ya capturaste `Entregado por`
- el arqueo físico está bien contado
- los retiros a bóveda, si existen, ya fueron capturados

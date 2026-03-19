# Guia rapida Corte Z para empleados

Usa esta version corta cuando solo necesites recordar que llenar y en que orden.

## Orden recomendado
1. `Total del ticket`
2. `Arqueo de efectivo en comprobante Versatil`
3. `Datos generales del corte`
4. `Datos del ticket POS`
5. `Arqueo fisico`
6. `Retiros a bóveda` si hubo
7. `Controles adicionales del cajero`
8. `Conciliacion automatica`
9. Guardar Corte Z

## Secciones obligatorias
- `Datos clave`
- `Datos generales del corte`
- `Datos del ticket POS`
- `Arqueo fisico`
- `Conciliacion automatica`

## Secciones opcionales o segun el caso
- `Desglose de venta por producto (Opcional)`
- `Retiros a bóveda` solo si hubo retiros
- `Controles adicionales del cajero` solo llena los conceptos que si existieron

## Que poner en cada seccion

### Datos clave
- `Total del ticket`: total general del ticket POS
- `Arqueo de efectivo en comprobante Versatil`: efectivo reportado por Versatil

### Datos generales del corte
- fecha
- empleado / cajero
- inicio y fin
- entregado por
- demas datos del corte

### Datos del ticket POS
- contado
- reembolsos
- ventas facturadas si aplica
- USD y tipo de cambio si aplica

### Arqueo fisico
- cuenta billetes MXN
- cuenta monedas MXN
- cuenta USD si hubo
- captura solo cantidades

### Retiros a bóveda
- capturalos solo si de verdad hubo retiro
- si forman parte del efectivo entregado
- usa `Agregar retiro a bóveda adicional` si hubo mas de uno

### Controles adicionales del cajero
- `Fondo de caja inicial`: informativo
- `Reembolsos del dia`: automatico
- `Retiros a bóveda`: informativo
- `Gastos`, `Depositos / retiros parciales`, `Vales`, `Cheques`, `Transferencias`, `Otros ajustes`: solo si ocurrieron

## Reglas clave
- `Fondo de caja inicial` no debe generar faltante por si solo
- `Transferencias identificadas` no cuentan como efectivo
- `Retiros a bóveda` si cuentan como parte del corte entregado
- si `credito facturado + efectivo facturado` no coincide con `total facturado`, revisa antes de guardar

## Revision final
Antes de guardar confirma:
- ya capturaste `Total del ticket`
- ya capturaste `Versatil`
- el arqueo fisico esta bien contado
- los retiros a bóveda si existen ya fueron capturados
- no dejaste en blanco algo obligatorio


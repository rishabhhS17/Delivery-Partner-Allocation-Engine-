# Core API Surface

| Method | Endpoint                  | Purpose                                   |
|--------|---------------------------|-------------------------------------------|
| POST   | `/riders`                 | Register a rider                          |
| GET    | `/riders`                 | List riders                               |
| GET    | `/riders/:id`             | Rider details                             |
| PUT    | `/riders/:id/location`    | Update rider location                     |
| PUT    | `/riders/:id/status`      | Update availability/status                |
| POST   | `/restaurants`            | Add a restaurant                          |
| GET    | `/restaurants`            | List restaurants                          |
| DELETE | `/restaurants/:id`        | Remove / deactivate a restaurant          |
| POST   | `/customers`              | Add a customer                            |
| GET    | `/customers`              | List customers                            |
| DELETE | `/customers/:id`          | Soft-delete a customer                    |
| POST   | `/orders`                 | Create an order (single)                  |
| POST   | `/orders/bulk`            | Create N orders at once                   |
| GET    | `/orders`                 | List orders                               |
| GET    | `/orders/:id`             | Order details                             |
| POST   | `/allocate-order`         | Trigger allocation for an order           |
| GET    | `/allocation-history`     | Allocation audit trail                    |
| GET    | `/config/weights`         | Get current scoring weights               |
| PUT    | `/config/weights`         | Update scoring weights (normalized to 1)  |

Live map updates are pushed over a WebSocket channel rather than polled.

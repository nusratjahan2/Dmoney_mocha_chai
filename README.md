# dMoney Integration Testing (Mocha + Chai + Axios)

Integration tests for the dMoney API running on localhost. The suite covers the full money-flow between system, agent, customers and merchant.

## Tech stack
- [Mocha](https://mochajs.org/): test runner
- [Chai](https://www.chaijs.com/): assertions
- [Axios](https://axios-http.com/): HTTP client
- [Faker](https://fakerjs.dev/): random user names and emails
- [dotenv](https://github.com/motdotla/dotenv): loads the base URL and credentials from `.env`

## Test scenarios
| # | Scenario | Assertions |
|---|----------|------------|
| 1 | Admin login | 200, token returned |
| 2 | Register 2 customers, 1 agent, 1 merchant | 201, role and `pending` status; duplicate returns 208 |
| 3 | Admin activates all users, then each user logs in | 200, status `active`, token returned |
| 4 | System account deposits 5000 tk to the agent | 201 |
| 5 | Agent deposits 2000 tk to customer 1 | 201, commission = 2.5% (50 tk); negative: amount below minimum (400), unknown account (404) |
| 6 | Customer 1 sends 1000 tk to customer 2 | 201, service fee = 5 tk |
| 7 | Customer 2 cashes out 500 tk via the agent | 201, service fee = 1% (5 tk); negative: other user's account (404), over daily limit (400) |
| 8 | Customer 2 pays 400 tk to the merchant | 201, service fee = 5 tk; negative: insufficient balance (400/403), unknown merchant (404) |

Each run registers new users with random emails and phone numbers, so you can run the suite again without cleaning up.

## Setup
1. Start the dMoney API locally (default `http://localhost:5000`).
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the project root (see `.env.example`):
   ```env
   baseurl=http://localhost:5000
   partnerkey=ROADTOSDET
   admin_email=admin@dmoney.com
   admin_password=1234
   system_email=system@dmoney.com
   system_password=1234
   default_otp=
   ```
   Set `default_otp` if your API asks for OTP verification after login.

## Run
```bash
npm test
```

## Test output
![alt text](<Screenshot 2026-11-20 131327.png>)

# Checkout revamp — product requirements

## 1. Cart

1.1 A signed-in user can add up to 50 distinct items to their cart. Attempting to add
a 51st item shows the message "Your cart is full" and does not modify the cart.

1.2 Item quantity must be an integer between 1 and 99. Values outside this range are
rejected inline with "Quantity must be between 1 and 99".

1.3 The cart persists for 30 days for signed-in users, and until the browser session
ends for guests.

1.4 Removing the last item returns the user to the empty-cart state, which shows a
"Continue shopping" link.

## 2. Promo codes

2.1 A user may apply exactly one promo code per order. Applying a second code replaces
the first and shows "SAVE20 replaced WELCOME10".

2.2 A promo code is valid only when the cart subtotal is at or above the code's minimum.
The minimum for SAVE20 is $50.00.

2.3 An expired code is rejected with "This code expired on {date}".

2.4 Percentage discounts are applied to the subtotal before tax and never reduce the
order total below $0.00.

## 3. Payment

3.1 Supported methods are saved card, new card, and stored account credit.

3.2 A declined payment returns the user to the payment step with the cart intact and
shows the issuer's decline reason.

3.3 Orders are never charged twice. A repeated submit of the same payment intent must
be idempotent.

3.4 Payment must complete within 90 seconds or the attempt is abandoned and the reserved
inventory released.

## 4. Roles and access

4.1 Only the account owner can use stored account credit. Invited members see the
option greyed out with a tooltip.

4.2 A member removed from an account mid-session loses access to shared payment methods
on their next request.

## 5. Non-functional

5.1 The checkout page reaches interactive within 2.5 seconds on a 4G connection.

5.2 All checkout form fields are reachable and operable by keyboard alone, and every
error message is announced by screen readers.

5.3 Prices display in the user's locale format, including currencies that use a comma
as the decimal separator.

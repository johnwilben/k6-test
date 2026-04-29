// ─── Auth ───────────────────────────────────────────────────────────────────

export const GET_CUSTOMER_PROFILE = `
  query GetCustomerProfile {
    customer {
      id
      firstname
      lastname
      email
      addresses {
        id
        firstname
        lastname
        street
        city
        postcode
        telephone
        country_code
        default_billing
        default_shipping
      }
      wishlist {
        id
        items_count
      }
      orders {
        total_count
      }
    }
  }
`;

// ─── Products ────────────────────────────────────────────────────────────────

export const SEARCH_PRODUCTS = `
  query SearchProducts($search: String!, $pageSize: Int, $currentPage: Int) {
    products(search: $search, pageSize: $pageSize, currentPage: $currentPage) {
      total_count
      items {
        id
        sku
        name
        url_key
        price_range {
          minimum_price {
            regular_price {
              value
              currency
            }
          }
        }
        small_image {
          url
          label
        }
      }
      page_info {
        current_page
        page_size
        total_pages
      }
    }
  }
`;

export const FILTER_PRODUCTS = `
  query FilterProducts(
    $categoryId: String
    $pageSize: Int
    $currentPage: Int
    $sortField: ProductAttributeSortInput
  ) {
    products(
      filter: { category_id: { eq: $categoryId } }
      pageSize: $pageSize
      currentPage: $currentPage
      sort: $sortField
    ) {
      total_count
      items {
        id
        sku
        name
        url_key
        price_range {
          minimum_price {
            regular_price {
              value
              currency
            }
          }
        }
      }
    }
  }
`;

export const GET_PRODUCT_DETAIL = `
  query GetProductDetail($urlKey: String!) {
    products(filter: { url_key: { eq: $urlKey } }) {
      items {
        id
        sku
        name
        description { html }
        price_range {
          minimum_price {
            regular_price { value currency }
            final_price { value currency }
            discount { amount_off percent_off }
          }
        }
        media_gallery {
          url
          label
        }
        ... on ConfigurableProduct {
          configurable_options {
            attribute_code
            label
            values { uid label swatch_data { value } }
          }
          variants {
            attributes { uid code value_index label }
            product { id sku price_range { minimum_price { final_price { value currency } } } }
          }
        }
      }
    }
  }
`;

// ─── Cart ────────────────────────────────────────────────────────────────────

export const CREATE_GUEST_CART = `
  mutation CreateGuestCart {
    createEmptyCart
  }
`;

export const CREATE_CUSTOMER_CART = `
  mutation CreateCustomerCart {
    createEmptyCart
  }
`;

export const GET_CART = `
  query GetCart($cartId: String!) {
    cart(cart_id: $cartId) {
      id
      total_quantity
      items {
        id
        quantity
        product {
          id
          sku
          name
          price_range {
            minimum_price {
              final_price { value currency }
            }
          }
        }
      }
      prices {
        grand_total { value currency }
        subtotal_including_tax { value currency }
      }
    }
  }
`;

export const ADD_SIMPLE_PRODUCT_TO_CART = `
  mutation AddSimpleProductToCart($cartId: String!, $sku: String!, $quantity: Float!) {
    addSimpleProductsToCart(
      input: {
        cart_id: $cartId
        cart_items: [{ data: { sku: $sku, quantity: $quantity } }]
      }
    ) {
      cart {
        id
        total_quantity
        items {
          id
          quantity
          product { sku name }
        }
      }
    }
  }
`;

export const ADD_CONFIGURABLE_PRODUCT_TO_CART = `
  mutation AddConfigurableProductToCart(
    $cartId: String!
    $parentSku: String!
    $childSku: String!
    $quantity: Float!
  ) {
    addConfigurableProductsToCart(
      input: {
        cart_id: $cartId
        cart_items: [{
          parent_sku: $parentSku
          data: { sku: $childSku, quantity: $quantity }
        }]
      }
    ) {
      cart {
        id
        total_quantity
        items {
          id
          quantity
          product { sku name }
        }
      }
    }
  }
`;

export const REMOVE_CART_ITEM = `
  mutation RemoveCartItem($cartId: String!, $itemId: Int!) {
    removeItemFromCart(input: { cart_id: $cartId, cart_item_id: $itemId }) {
      cart {
        id
        total_quantity
        items {
          id
          quantity
          product { sku name }
        }
      }
    }
  }
`;

// ─── Wishlist ─────────────────────────────────────────────────────────────────

export const GET_WISHLIST = `
  query GetWishlist {
    customer {
      wishlist {
        id
        items_count
        items {
          id
          qty
          product {
            id
            sku
            name
            price_range {
              minimum_price {
                final_price { value currency }
              }
            }
          }
        }
      }
    }
  }
`;

export const ADD_TO_WISHLIST = `
  mutation AddToWishlist($sku: String!) {
    addProductsToWishlist(
      wishlistId: "0"
      wishlistItems: [{ sku: $sku, quantity: 1 }]
    ) {
      wishlist {
        id
        items_count
        items {
          id
          product { sku name }
        }
      }
      user_errors { code message }
    }
  }
`;

export const REMOVE_FROM_WISHLIST = `
  mutation RemoveFromWishlist($wishlistItemId: ID!) {
    removeProductsFromWishlist(
      wishlistId: "0"
      wishlistItemsIds: [$wishlistItemId]
    ) {
      wishlist {
        id
        items_count
      }
      user_errors { code message }
    }
  }
`;

// ─── Addresses ───────────────────────────────────────────────────────────────

export const CREATE_ADDRESS = `
  mutation CreateAddress(
    $firstname: String!
    $lastname: String!
    $street: [String!]!
    $city: String!
    $postcode: String!
    $telephone: String!
    $countryCode: String!
  ) {
    createCustomerAddress(
      input: {
        firstname: $firstname
        lastname: $lastname
        street: $street
        city: $city
        postcode: $postcode
        telephone: $telephone
        country_code: $countryCode
        default_shipping: false
        default_billing: false
      }
    ) {
      id
      firstname
      lastname
      street
      city
      postcode
      telephone
    }
  }
`;

export const UPDATE_ADDRESS = `
  mutation UpdateAddress(
    $id: Int!
    $firstname: String
    $lastname: String
    $street: [String]
    $city: String
    $postcode: String
    $telephone: String
  ) {
    updateCustomerAddress(
      id: $id
      input: {
        firstname: $firstname
        lastname: $lastname
        street: $street
        city: $city
        postcode: $postcode
        telephone: $telephone
      }
    ) {
      id
      firstname
      lastname
      street
      city
      postcode
    }
  }
`;

export const DELETE_ADDRESS = `
  mutation DeleteAddress($id: Int!) {
    deleteCustomerAddress(id: $id)
  }
`;

// ─── Orders ──────────────────────────────────────────────────────────────────

export const GET_ORDERS = `
  query GetOrders($pageSize: Int, $currentPage: Int) {
    customer {
      orders(pageSize: $pageSize, currentPage: $currentPage) {
        total_count
        items {
          id
          number
          order_date
          status
          total {
            grand_total { value currency }
          }
          items {
            product_name
            product_sku
            quantity_ordered
            product_sale_price { value currency }
          }
        }
        page_info {
          current_page
          page_size
          total_pages
        }
      }
    }
  }
`;

import { Result } from "./Result"
import { GaloyWallet, WalletsBalances } from "./GaloyWalletTypes"
import {
  ApolloClient,
  NormalizedCacheObject,
  createHttpLink,
  gql,
  InMemoryCache,
} from "@apollo/client/core"
import fetch from "node-fetch"
import { pino } from "pino"

const IN_MEMORY_CACHE_CONFIG = {
  typePolicies: {
    Query: {
      fields: {
        // wallets: {
        //   read() {
        //     return [
        //       {
        //         id: "USDWallet",
        //         balance: 100,
        //         walletCurrency: "USD",
        //       },
        //       {
        //         id: "BTCWallet",
        //         balance: 1_000_000, // 100 USD @ 10k USD/BTC
        //         walletCurrency: "BTC",
        //       },
        //     ]
        //   },
        // },
        // getLastOnChainAddress: {
        //   read() {
        //     return {
        //       id: "bc1qmyhq2rm8edqv076dj89r5utskt3394m7xu3pge",
        //     }
        //   },
        // },
      },
    },
  },
}

const WALLETS = gql`
  query wallets {
    wallet {
      id
      balance
      walletCurrency
    }
  }
`

const GET_ONCHAIN_ADDRESS = gql`
  query getLastOnChainAddress {
    getLastOnChainAddress {
      id
    }
  }
`
const ONCHAIN_PAY = gql`
  mutation onchain_pay($address: String!, $amount: Int!, $memo: String) {
    onchain {
      pay(address: $address, amount: $amount, memo: $memo) {
        success
      }
    }
  }
`

export class DealerRemoteWallet implements GaloyWallet {
  client: ApolloClient<NormalizedCacheObject>
  logger: pino.Logger

  constructor(logger: pino.Logger) {
    const GRAPHQL_URI = process.env["GRAPHQL_URI"]
    const httpLink = createHttpLink({ uri: GRAPHQL_URI, fetch })
    const cache = new InMemoryCache(IN_MEMORY_CACHE_CONFIG)
    this.client = new ApolloClient({ link: httpLink, cache: cache })
    this.logger = logger.child({ class: DealerRemoteWallet.name })
  }

  public async getWalletsBalances(): Promise<Result<WalletsBalances>> {
    const logger = this.logger.child({ method: "getWalletsBalances()" })
    try {
      const result = await this.client.query({ query: WALLETS })
      logger.debug(
        { WALLET: WALLETS, result },
        "{WALLET} query to galoy graphql api successful with {result}",
      )

      const btcWallet = result.data.wallets?.find((wallet) => wallet?.id === "BTCWallet")
      const btcWalletId = btcWallet?.id
      const btcWalletBalance = btcWallet?.balance ?? NaN

      const usdWallet = result.data.wallets?.find((wallet) => wallet?.id === "USDWallet")
      const usdWalletId = usdWallet?.id
      // TODO: figure out if the balance will always be positive or not in that new implementation
      const usdWalletBalance = -usdWallet?.balance ?? NaN

      return {
        ok: true,
        value: { btcWalletId, btcWalletBalance, usdWalletId, usdWalletBalance },
      }
    } catch (error) {
      logger.error(
        { WALLET: WALLETS, error },
        "{WALLET} query to galoy graphql api failed with {error}",
      )
      return { ok: false, error }
    }
  }

  public async getUsdWalletBalance(): Promise<Result<number>> {
    const result = await this.getWalletsBalances()
    if (result.ok) {
      return { ok: true, value: result.value.usdWalletBalance }
    }
    return result
  }

  public async getBtcWalletBalance(): Promise<Result<number>> {
    const result = await this.getWalletsBalances()
    if (result.ok) {
      return { ok: true, value: result.value.btcWalletBalance }
    }
    return result
  }

  public async getWalletOnChainDepositAddress(): Promise<Result<string>> {
    const logger = this.logger.child({ method: "getWalletOnChainDepositAddress()" })
    try {
      const result = await this.client.query({ query: GET_ONCHAIN_ADDRESS })
      logger.debug(
        { GET_ONCHAIN_ADDRESS, result },
        "{GET_ONCHAIN_ADDRESS} query to galoy graphql api successful with {result}",
      )
      return { ok: true, value: result.data.getLastOnChainAddress.id }
    } catch (error) {
      logger.error(
        { GET_ONCHAIN_ADDRESS, error },
        "{GET_ONCHAIN_ADDRESS} query to galoy graphql api failed with {error}",
      )
      return { ok: false, error }
    }
  }

  public async payOnChain(
    address: string,
    btcAmountInSats: number,
    memo: string,
  ): Promise<Result<void>> {
    const logger = this.logger.child({ method: "payOnChain()" })
    try {
      const variables = { address: address, amount: btcAmountInSats, memo: memo }
      const result = await this.client.mutate({
        mutation: ONCHAIN_PAY,
        variables: variables,
      })
      logger.debug(
        { ONCHAIN_PAY, variables, result },
        "{ONCHAIN_PAY} mutation with {variables} to galoy graphql api successful with {result}",
      )
      return { ok: true, value: undefined }
    } catch (error) {
      logger.error(
        { ONCHAIN_PAY, error },
        "{ONCHAIN_PAY} mutation to galoy graphql api failed with {error}",
      )
      return { ok: false, error }
    }
  }
}